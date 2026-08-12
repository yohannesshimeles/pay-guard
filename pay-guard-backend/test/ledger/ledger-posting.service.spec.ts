import { ConflictException } from '@nestjs/common';
import { CentralDao, DaoTransaction } from '../../src/database/central.dao';
import {
  LedgerDao,
  LedgerPostingConflictError,
} from '../../src/ledger/ledger.dao';
import { LedgerEntryType } from '../../src/ledger/ledger-entry-type.enum';
import { LedgerPostingService } from '../../src/ledger/ledger-posting.service';

describe('LedgerPostingService', () => {
  const boundary = {} as DaoTransaction;
  const transaction = jest.fn((work: (value: DaoTransaction) => Promise<unknown>) =>
    work(boundary),
  );
  const postWithin = jest.fn();
  const reverseWithin = jest.fn();
  const service = new LedgerPostingService(
    { transaction } as unknown as CentralDao,
    { postWithin, reverseWithin } as unknown as LedgerDao,
  );
  const input = {
    businessId: 'business-id', settlementAccountId: 'account-id',
    entryType: LedgerEntryType.WITHDRAWAL, amount: '10.00',
    actualTransactionAt: new Date('2026-08-09T10:00:00.000Z'),
    sourceRecordType: 'WITHDRAWAL', sourceRecordId: 'source-id',
    description: 'Branch cash withdrawal', auditLogId: 'audit-id',
    idempotencyKey: 'ledger:withdrawal:source-id',
  } as const;

  beforeEach(() => jest.clearAllMocks());

  it('posts only inside the central database transaction', async () => {
    postWithin.mockResolvedValueOnce({ replayed: false });
    await service.post(input);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(postWithin).toHaveBeenCalledWith(boundary, input);
  });

  it('rejects invalid precision before entering the database', () => {
    expect(() => service.post({ ...input, amount: '10.001' })).toThrow(
      'Ledger posting input is invalid',
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('maps changed idempotency reuse to an HTTP conflict', async () => {
    postWithin.mockRejectedValueOnce(new LedgerPostingConflictError());
    await expect(service.post(input)).rejects.toBeInstanceOf(ConflictException);
  });
});
