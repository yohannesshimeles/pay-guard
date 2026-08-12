import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OBJECT_STORAGE, ObjectStoragePort } from '../storage/object-storage.port';
import { ReportExportType } from './dto/report-export.dto';
import { FinancialReportDao } from './financial-report.dao';
import { OperationalReportDao } from './operational-report.dao';
import { ReportExportDao } from './report-export.dao';

@Injectable()
export class ReportExportWorker {
  private readonly logger = new Logger(ReportExportWorker.name);

  constructor(
    private readonly exports: ReportExportDao,
    private readonly financial: FinancialReportDao,
    private readonly operational: OperationalReportDao,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
  ) {}

  async processNext(): Promise<'EXPIRED' | 'GENERATED' | 'DEFERRED' | 'FAILED' | 'IDLE'> {
    const expired = await this.exports.claimExpired();
    if (expired) {
      await this.storage.deleteObject(expired.objectKey).catch(() =>
        this.logger.warn(JSON.stringify({ event: 'report_export.delete_failed' })),
      );
      return 'EXPIRED';
    }
    const claim = await this.exports.claimNext();
    if (!claim) return 'IDLE';
    let objectKey: string | undefined;
    try {
      const scope = { businessId: claim.businessId, branchId: claim.branchId };
      const report = claim.reportType === ReportExportType.FINANCIAL_SUMMARY
        ? await this.financial.summary(scope, {
          dateFrom: claim.dateFrom, dateTo: claim.dateTo,
          settlementAccountId: claim.settlementAccountId,
        })
        : await this.operational.businessSummary(scope, {
          dateFrom: claim.dateFrom, dateTo: claim.dateTo,
        });
      const body = new TextEncoder().encode(toCsv(report));
      objectKey = `private/report-exports/${claim.businessId}/${claim.jobId}.csv`;
      await this.storage.putObject(objectKey, body, 'text/csv; charset=utf-8');
      await this.exports.complete(claim, {
        objectKey,
        fileName: `payguard-${claim.reportType.toLowerCase()}-${claim.jobId}.csv`,
        sizeBytes: body.byteLength, contentType: 'text/csv; charset=utf-8',
        sha256: createHash('sha256').update(body).digest('hex'),
      });
      return 'GENERATED';
    } catch {
      if (objectKey) await this.storage.deleteObject(objectKey).catch(() => undefined);
      await this.exports.fail(claim, 'EXPORT_GENERATION_FAILED');
      return claim.attemptNo >= 3 ? 'FAILED' : 'DEFERRED';
    }
  }
}

export function toCsv(value: unknown): string {
  const rows: Array<[string, string]> = [];
  flatten('', value, rows);
  return ['metric,value', ...rows.map(([key, item]) =>
    `${csvCell(key)},${csvCell(item)}`)].join('\r\n') + '\r\n';
}

function flatten(prefix: string, value: unknown, rows: Array<[string, string]>): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(`${prefix}[${index}]`, item, rows));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      flatten(prefix ? `${prefix}.${key}` : key, item, rows);
    }
  } else {
    rows.push([prefix, primitiveToString(value)]);
  }
}

function primitiveToString(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' ||
      typeof value === 'boolean') return String(value);
  return '';
}

function csvCell(value: string): string {
  const safe = /^[=+\-@]/u.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/gu, '""')}"`;
}
