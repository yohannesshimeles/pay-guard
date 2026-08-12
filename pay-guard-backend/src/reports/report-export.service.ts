import {
  BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { OBJECT_STORAGE, ObjectStoragePort } from '../storage/object-storage.port';
import { CreateReportExportDto, ReportExportType } from './dto/report-export.dto';
import { ReportExportDao } from './report-export.dao';
import { auditActorFromPrincipal } from '../audit/v2-audit.service';

const EXPORT_ROLES = [
  'BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER', 'MANAGER', 'CASHIER',
];

@Injectable()
export class ReportExportService {
  constructor(
    private readonly exports: ReportExportDao,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
  ) {}

  async create(
    businessId: string,
    input: CreateReportExportDto,
    actor: AuthenticatedPrincipal,
  ) {
    const branchId = this.authorizedBranch(businessId, input.branchId, actor);
    this.assertRange(input.dateFrom, input.dateTo);
    if (
      input.reportType === ReportExportType.OPERATIONAL_SUMMARY &&
      input.settlementAccountId
    ) {
      throw new BadRequestException(
        'settlementAccountId is only supported by financial exports',
      );
    }
    const job = await this.exports.create({
      businessId, branchId, requestedByUserId: actor.userId,
      requestedRole: actor.role, idempotencyKey: input.idempotencyKey,
      reportType: input.reportType, dateFrom: input.dateFrom,
      dateTo: input.dateTo, settlementAccountId: input.settlementAccountId,
      actor: auditActorFromPrincipal(actor), sessionId: actor.sessionId,
    });
    if (
      job.businessId !== businessId || job.branchId !== branchId ||
      job.reportType !== input.reportType || job.dateFrom !== input.dateFrom ||
      job.dateTo !== input.dateTo ||
      job.settlementAccountId !== input.settlementAccountId
    ) {
      throw new BadRequestException('Idempotency key was used for another export');
    }
    return job;
  }

  async require(
    businessId: string,
    jobId: string,
    actor: AuthenticatedPrincipal,
  ) {
    this.authorizedBranch(businessId, undefined, actor);
    const job = await this.exports.findOwned(jobId, businessId, actor.userId);
    if (!job) throw new NotFoundException('Report export not found');
    return job;
  }

  async download(
    businessId: string,
    jobId: string,
    actor: AuthenticatedPrincipal,
  ) {
    this.authorizedBranch(businessId, undefined, actor);
    const file = await this.exports.findDownloadOwned(jobId, businessId, actor.userId);
    if (!file) throw new NotFoundException('Report export file not found');
    const body = await this.storage.getObject(file.objectKey);
    await this.exports.recordDownload({
      fileId: file.id,
      jobId: file.jobId,
      userId: actor.userId,
      businessId,
      branchId: actor.branchId,
      actor: auditActorFromPrincipal(actor),
      sessionId: actor.sessionId,
    });
    return { ...file, objectKey: undefined, body };
  }

  private authorizedBranch(
    businessId: string,
    requestedBranchId: string | undefined,
    actor: AuthenticatedPrincipal,
  ): string | undefined {
    if (
      actor.identityType === 'PLATFORM_ADMIN' ||
      !actor.businessIds.includes(businessId) || !EXPORT_ROLES.includes(actor.role)
    ) {
      throw new ForbiddenException('Report export access required');
    }
    if (actor.branchId) {
      if (requestedBranchId && requestedBranchId !== actor.branchId) {
        throw new ForbiddenException('Selected branch scope cannot be overridden');
      }
      return actor.branchId;
    }
    if (['MANAGER', 'CASHIER'].includes(actor.role)) {
      throw new ForbiddenException('Branch scope required');
    }
    return requestedBranchId;
  }

  private assertRange(dateFrom: string, dateTo: string): void {
    const from = Date.parse(`${dateFrom.slice(0, 10)}T00:00:00.000Z`);
    const to = Date.parse(`${dateTo.slice(0, 10)}T00:00:00.000Z`);
    const days = Math.floor((to - from) / 86_400_000) + 1;
    if (from > to) throw new BadRequestException('dateFrom must not be after dateTo');
    if (days > 366) {
      throw new BadRequestException('Report export range cannot exceed 366 days');
    }
  }
}
