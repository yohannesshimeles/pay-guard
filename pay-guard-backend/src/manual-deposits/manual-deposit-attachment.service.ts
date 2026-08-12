import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CentralDao } from '../database/central.dao';
import { MalwareScanStatus } from '../qr-processing/enums/malware-scan-status.enum';
import { ProofFileValidator } from '../qr-processing/proof-file.validator';
import { MALWARE_SCANNER, MalwareScannerPort } from '../qr-processing/ports/malware-scanner.port';
import { OBJECT_STORAGE, ObjectStoragePort } from '../storage/object-storage.port';
import {
  ManualDepositAttachmentConflictError,
  ManualDepositDao,
  ManualDepositNotFoundError,
} from './manual-deposit.dao';

const extensionByMime: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

@Injectable()
export class ManualDepositAttachmentService {
  private readonly logger = new Logger(ManualDepositAttachmentService.name);

  constructor(
    private readonly validator: ProofFileValidator,
    @Inject(MALWARE_SCANNER) private readonly malware: MalwareScannerPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    private readonly centralDao: CentralDao,
    private readonly deposits: ManualDepositDao,
  ) {}

  async upload(
    businessId: string,
    branchId: string,
    depositId: string,
    actor: AuthenticatedPrincipal,
    input: { fileName: string; mimeType: string; body: Uint8Array },
  ) {
    if (
      actor.role !== 'CASHIER' || actor.identityType !== 'BUSINESS_USER' ||
      !actor.businessIds.includes(businessId) || actor.branchId !== branchId ||
      !actor.membershipRoleId
    ) {
      throw new NotFoundException('Manual deposit not found');
    }
    const file = this.validator.validate(input);
    const scan = await this.malware.scan(file);
    if (scan.status === MalwareScanStatus.INFECTED) {
      throw new UnprocessableEntityException('Attachment failed security validation');
    }
    if (scan.status !== MalwareScanStatus.CLEAN) {
      throw new ServiceUnavailableException('Attachment security scan is unavailable');
    }
    const extension = extensionByMime[file.mimeType];
    const objectKey = `private/manual-deposit-attachments/${randomUUID()}.${extension}`;
    await this.storage.putObject(objectKey, file.body, file.mimeType);
    try {
      const deposit = await this.centralDao.transaction((transaction) =>
        this.deposits.attachWithin(transaction, {
          depositId, businessId, branchId,
          uploadedByUserId: actor.userId,
          cashierRoleAssignmentId: actor.membershipRoleId!,
          objectKey, fileName: file.fileName, mimeType: file.mimeType,
          sizeBytes: file.sizeBytes, sha256: file.sha256,
        }),
      );
      return deposit.toPublicModel();
    } catch (error) {
      await this.storage.deleteObject(objectKey).catch(() =>
        this.logger.warn(JSON.stringify({
          event: 'manual_deposit_attachment_compensation_failed', depositId,
        })),
      );
      if (error instanceof ManualDepositAttachmentConflictError) {
        throw new ConflictException('Manual deposit already has an attachment');
      }
      if (error instanceof ManualDepositNotFoundError) {
        throw new NotFoundException('Manual deposit not found');
      }
      throw error;
    }
  }
}
