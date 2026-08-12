import { randomUUID, createHash } from 'node:crypto';
import {
  ConflictException, ForbiddenException, Inject, Injectable, Logger,
  NotFoundException,
} from '@nestjs/common';
import { V2AuditService } from '../audit/v2-audit.service';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { V2SelectedAuthContext } from '../auth/v2-auth.types';
import { CentralDao } from '../database/central.dao';
import { OBJECT_STORAGE, ObjectStoragePort } from '../storage/object-storage.port';
import { ProofIntakeService } from '../qr-processing/proof-intake.service';
import { ProofMimeType } from '../qr-processing/enums/proof-mime-type.enum';
import { QrExtractionState } from '../qr-processing/enums/qr-extraction-state.enum';
import { CreateSubscriptionPurchaseDto, ListSubscriptionPurchasesDto } from './dto/subscription-purchase.dto';
import {
  SubscriptionProofConflictError, SubscriptionPurchaseDao,
  SubscriptionPurchaseNotFoundError, SubscriptionPurchaseReplayConflictError,
  SubscriptionPurchaseScopeError, SubscriptionPurchaseLockedError,
} from './subscription-purchase.dao';

const extensionByMime: Record<ProofMimeType, string> = {
  [ProofMimeType.JPEG]: 'jpg', [ProofMimeType.PNG]: 'png', [ProofMimeType.PDF]: 'pdf',
};

@Injectable()
export class SubscriptionPurchaseService {
  private readonly logger = new Logger(SubscriptionPurchaseService.name);

  constructor(
    private readonly centralDao: CentralDao,
    private readonly purchases: SubscriptionPurchaseDao,
    private readonly intake: ProofIntakeService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    private readonly audit: V2AuditService,
  ) {}

  listPlans(actor: AuthenticatedPrincipal) {
    this.assertBusinessActor(actor);
    return this.purchases.listPlans();
  }

  async create(businessId: string, branchId: string,
    input: CreateSubscriptionPurchaseDto, actor: AuthenticatedPrincipal) {
    this.assertOwner(businessId, actor);
    try {
      const result = await this.centralDao.transaction(async (transaction) => {
        const created = await this.purchases.createWithin(transaction, {
          id: input.idempotencyKey, businessId, branchId, planId: input.planId,
          paymentBankId: input.paymentBankId, actor,
        });
        if (!created.replayed) {
          await this.audit.recordWithin(transaction, {
            actor: this.auditActor(actor), sessionId: actor.sessionId,
            actionType: 'SUBSCRIPTION_PURCHASE_CREATED',
            recordType: 'SUBSCRIPTION_ORDER', recordId: created.purchase.props.id,
            businessId, branchId,
            newValue: { planId: input.planId, paymentBankId: input.paymentBankId,
              status: 'ORDER_CREATED' },
          });
        }
        return created;
      });
      return { purchase: result.purchase.toPublicModel(), replayed: result.replayed };
    } catch (error) {
      if (error instanceof SubscriptionPurchaseReplayConflictError ||
          (error as { code?: string }).code === '23505') {
        throw new ConflictException('Subscription purchase idempotency conflict');
      }
      if (error instanceof SubscriptionPurchaseScopeError) {
        throw new NotFoundException(
          'Active branch, plan, bank, platform account, or Owner membership not found',
        );
      }
      if (error instanceof SubscriptionPurchaseLockedError) {
        throw new ForbiddenException(
          'Subscription purchasing is locked pending fraud review',
        );
      }
      throw error;
    }
  }

  list(businessId: string, branchId: string, input: ListSubscriptionPurchasesDto,
    actor: AuthenticatedPrincipal) {
    this.assertOwner(businessId, actor);
    return this.purchases.list({ businessId, branchId }, input);
  }

  async require(businessId: string, branchId: string, purchaseId: string,
    actor: AuthenticatedPrincipal) {
    this.assertOwner(businessId, actor);
    const found = await this.purchases.find(purchaseId, businessId, branchId);
    if (!found) throw new NotFoundException('Subscription purchase not found');
    return found.toPublicModel();
  }

  async uploadProof(businessId: string, branchId: string, purchaseId: string,
    actor: AuthenticatedPrincipal,
    input: { fileName: string; mimeType: string; body: Uint8Array }) {
    this.assertOwner(businessId, actor);
    const purchase = await this.purchases.find(purchaseId, businessId, branchId);
    if (!purchase) throw new NotFoundException('Subscription purchase not found');
    if (purchase.props.status !== 'ORDER_CREATED') {
      throw new ConflictException('Subscription purchase proof already submitted');
    }
    const inspected = await this.intake.inspect(input);
    const objectKey = `private/subscription-purchase-proofs/${randomUUID()}.${
      extensionByMime[inspected.file.mimeType]}`;
    await this.storage.putObject(objectKey, inspected.file.body, inspected.file.mimeType);
    const candidate = inspected.extraction.state === QrExtractionState.SINGLE_QR
      ? inspected.extraction.candidates[0] : undefined;
    try {
      const stored = await this.centralDao.transaction(async (transaction) => {
        const result = await this.purchases.addProofWithin(transaction, {
          purchaseId, businessId, branchId, userId: actor.userId, objectKey,
          fileName: inspected.file.fileName, mimeType: inspected.file.mimeType,
          sizeBytes: inspected.file.sizeBytes, sha256: inspected.file.sha256,
          extractionState: inspected.extraction.state,
          candidateCount: inspected.extraction.candidates.length,
          ...(candidate ? { qrPayloadSha256: createHash('sha256')
            .update(candidate.rawValue).digest('hex') } : {}),
          ...(candidate?.parsed?.bankCode ? { parsedBankCode: candidate.parsed.bankCode } : {}),
          ...(candidate?.parsed?.reference ? { parsedReference: candidate.parsed.reference } : {}),
          ...(candidate?.parsed?.amountEtb ? { parsedAmountEtb: candidate.parsed.amountEtb } : {}),
          ...(candidate?.parsed?.accountSuffix
            ? { parsedAccountSuffix: candidate.parsed.accountSuffix } : {}),
          ...(candidate?.parsed?.transactionDate
            ? { parsedTransactionDate: candidate.parsed.transactionDate } : {}),
          ...(candidate?.parsed?.transactionTime
            ? { parsedTransactionTime: candidate.parsed.transactionTime } : {}),
        });
        await this.audit.recordWithin(transaction, {
          actor: this.auditActor(actor), sessionId: actor.sessionId,
          actionType: 'SUBSCRIPTION_PURCHASE_PROOF_RECEIVED',
          recordType: 'SUBSCRIPTION_ORDER', recordId: purchaseId,
          businessId, branchId,
          newValue: { status: 'PROOF_RECEIVED',
            extractionState: inspected.extraction.state,
            candidateCount: inspected.extraction.candidates.length },
        });
        return result;
      });
      return stored.toPublicModel();
    } catch (error) {
      await this.storage.deleteObject(objectKey).catch(() => this.logger.warn(
        JSON.stringify({ event: 'subscription_proof_storage_compensation_failed', purchaseId }),
      ));
      if (error instanceof SubscriptionProofConflictError) {
        throw new ConflictException('Subscription purchase proof already submitted');
      }
      if (error instanceof SubscriptionPurchaseNotFoundError) {
        throw new NotFoundException('Subscription purchase not found');
      }
      throw error;
    }
  }

  private assertBusinessActor(actor: AuthenticatedPrincipal) {
    if (actor.identityType !== 'BUSINESS_USER') {
      throw new ForbiddenException('Business authentication required');
    }
  }

  private assertOwner(businessId: string, actor: AuthenticatedPrincipal) {
    if (actor.identityType !== 'BUSINESS_USER' ||
        !['PRIMARY_OWNER', 'ADDITIONAL_OWNER'].includes(actor.role) ||
        !actor.businessIds.includes(businessId) || !actor.membershipId ||
        !actor.membershipRoleId) {
      throw new ForbiddenException('Active Owner business context required');
    }
  }

  private auditActor(actor: AuthenticatedPrincipal): V2SelectedAuthContext {
    return {
      identityType: 'BUSINESS_USER', subjectId: actor.userId,
      role: actor.role as V2SelectedAuthContext['role'],
      businessId: actor.businessIds[0], membershipId: actor.membershipId,
      membershipRoleId: actor.membershipRoleId, branchId: actor.branchId,
    };
  }
}
