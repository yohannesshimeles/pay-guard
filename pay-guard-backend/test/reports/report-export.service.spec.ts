import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { ReportExportType } from '../../src/reports/dto/report-export.dto';
import { ReportExportDao } from '../../src/reports/report-export.dao';
import { ReportExportService } from '../../src/reports/report-export.service';
import { ObjectStoragePort } from '../../src/storage/object-storage.port';

describe('ReportExportService', () => {
  const create = jest.fn();
  const findOwned = jest.fn();
  const findDownloadOwned = jest.fn();
  const recordDownload = jest.fn<Promise<void>, [Record<string, unknown>]>();
  const getObject = jest.fn();
  const service = new ReportExportService({
    create, findOwned, findDownloadOwned, recordDownload,
  } as unknown as ReportExportDao, { getObject } as unknown as ObjectStoragePort);
  const manager: AuthenticatedPrincipal = {
    userId: 'manager-id', sessionId: 'session-id', role: 'MANAGER',
    identityType: 'BUSINESS_USER', businessIds: ['business-id'],
    branchId: 'branch-id',
  };
  const input = {
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
    reportType: ReportExportType.FINANCIAL_SUMMARY,
    dateFrom: '2026-08-01', dateTo: '2026-08-13',
  };

  beforeEach(() => jest.clearAllMocks());

  it('persists the authenticated Manager branch in the immutable job scope', async () => {
    create.mockResolvedValueOnce({
      id: 'job-id', businessId: 'business-id', branchId: 'branch-id',
      reportType: input.reportType, dateFrom: input.dateFrom, dateTo: input.dateTo,
    });
    await service.create('business-id', input, manager);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-id', branchId: 'branch-id',
      requestedByUserId: 'manager-id', requestedRole: 'MANAGER',
    }));
  });

  it('rejects scope overrides, invalid filters and idempotency key reuse', async () => {
    await expect(service.create('business-id', {
      ...input, branchId: 'other-branch',
    }, manager)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.create('business-id', {
      ...input, reportType: ReportExportType.OPERATIONAL_SUMMARY,
      settlementAccountId: 'account-id',
    }, manager)).rejects.toBeInstanceOf(BadRequestException);
    create.mockResolvedValueOnce({
      businessId: 'business-id', branchId: 'branch-id',
      reportType: input.reportType, dateFrom: '2026-01-01', dateTo: input.dateTo,
    });
    await expect(service.create('business-id', input, manager))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('downloads only an owned, ready and unexpired file without exposing its key', async () => {
    findDownloadOwned.mockResolvedValueOnce({
      id: 'file-id', jobId: 'job-id', objectKey: 'private/reports/job.csv',
      fileName: 'report.csv', contentType: 'text/csv', sizeBytes: 4,
      sha256: 'a'.repeat(64), availableUntil: new Date('2026-09-01'),
    });
    getObject.mockResolvedValueOnce(new Uint8Array([1, 2, 3, 4]));
    const result = await service.download('business-id', 'job-id', manager);
    expect(getObject).toHaveBeenCalledWith('private/reports/job.csv');
    expect(recordDownload).toHaveBeenCalledWith(expect.objectContaining({
      fileId: 'file-id', jobId: 'job-id', userId: 'manager-id',
      businessId: 'business-id', branchId: 'branch-id', sessionId: 'session-id',
    }));
    const downloadInput = recordDownload.mock.calls[0][0] as {
      actor: { subjectId: string; role: string };
    };
    expect(downloadInput.actor).toMatchObject({
      subjectId: 'manager-id', role: 'MANAGER',
    });
    expect(result.objectKey).toBeUndefined();
    expect(result.body).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('conceals another requestor or expired export', async () => {
    findOwned.mockResolvedValueOnce(undefined);
    findDownloadOwned.mockResolvedValueOnce(undefined);
    await expect(service.require('business-id', 'job-id', manager))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(service.download('business-id', 'job-id', manager))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
