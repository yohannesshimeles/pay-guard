import { FinancialReportDao } from '../../src/reports/financial-report.dao';
import { OperationalReportDao } from '../../src/reports/operational-report.dao';
import { ReportExportType } from '../../src/reports/dto/report-export.dto';
import { ReportExportDao } from '../../src/reports/report-export.dao';
import { ReportExportWorker, toCsv } from '../../src/reports/report-export.worker';
import { ObjectStoragePort } from '../../src/storage/object-storage.port';

describe('ReportExportWorker', () => {
  const claimExpired = jest.fn();
  const claimNext = jest.fn();
  const complete = jest.fn();
  const fail = jest.fn();
  const financialSummary = jest.fn();
  const businessSummary = jest.fn();
  const putObject = jest.fn();
  const deleteObject = jest.fn();
  const worker = new ReportExportWorker({
    claimExpired, claimNext, complete, fail,
  } as unknown as ReportExportDao, {
    summary: financialSummary,
  } as unknown as FinancialReportDao, {
    businessSummary,
  } as unknown as OperationalReportDao, {
    putObject, deleteObject,
  } as unknown as ObjectStoragePort);
  const claim = {
    jobId: 'job-id', businessId: 'business-id', branchId: 'branch-id',
    requestedByUserId: 'user-id', reportType: ReportExportType.FINANCIAL_SUMMARY,
    dateFrom: '2026-08-01', dateTo: '2026-08-13',
    claimToken: 'claim-token', attemptNo: 1,
  };

  beforeEach(() => jest.clearAllMocks());

  it('generates, hashes, privately stores and completes a leased CSV job', async () => {
    claimExpired.mockResolvedValueOnce(undefined);
    claimNext.mockResolvedValueOnce(claim);
    financialSummary.mockResolvedValueOnce({
      businessId: 'business-id', creditTotal: '100.00',
      categories: [{ entryType: 'MANUAL_DEPOSIT', entryCount: 1 }],
    });
    await expect(worker.processNext()).resolves.toBe('GENERATED');
    expect(putObject).toHaveBeenCalledWith(
      'private/report-exports/business-id/job-id.csv',
      expect.any(Uint8Array), 'text/csv; charset=utf-8',
    );
    expect(complete).toHaveBeenCalledWith(claim, expect.objectContaining({
      objectKey: 'private/report-exports/business-id/job-id.csv',
    }));
    expect(JSON.stringify(complete.mock.calls)).toMatch(/[a-f0-9]{64}/u);
  });

  it('defers retryable generation failure and expires protected files', async () => {
    claimExpired.mockResolvedValueOnce(undefined);
    claimNext.mockResolvedValueOnce(claim);
    financialSummary.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(worker.processNext()).resolves.toBe('DEFERRED');
    expect(fail).toHaveBeenCalledWith(claim, 'EXPORT_GENERATION_FAILED');

    claimExpired.mockResolvedValueOnce({ objectKey: 'private/reports/expired.csv' });
    deleteObject.mockResolvedValueOnce(undefined);
    await expect(worker.processNext()).resolves.toBe('EXPIRED');
    expect(deleteObject).toHaveBeenCalledWith('private/reports/expired.csv');
  });

  it('escapes spreadsheet formulas and CSV quotes', () => {
    expect(toCsv({ safe: '=SUM(A1:A2)', quote: 'a"b' })).toContain(
      '"safe","\'=SUM(A1:A2)"',
    );
    expect(toCsv({ quote: 'a"b' })).toContain('"quote","a""b"');
  });
});
