import { CentralDao, DaoTransaction } from '../../src/database/central.dao';
import { TransactionSubmissionDao } from '../../src/transactions/transaction-submission.dao';

describe('TransactionSubmissionDao', () => {
  const optional = jest.fn<
    Promise<unknown>,
    [text: string, values?: readonly unknown[]]
  >();
  const execute = jest.fn<
    Promise<number>,
    [text: string, values?: readonly unknown[]]
  >();
  const boundary = { optional, execute } as unknown as DaoTransaction;
  const transaction = jest.fn<
    Promise<unknown>,
    [(work: DaoTransaction) => Promise<unknown>]
  >();
  transaction.mockImplementation((work) => work(boundary));
  const dao = new TransactionSubmissionDao({
    transaction,
  } as unknown as CentralDao);
  const input = {
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
    settlementAccountId: 'account-id',
    bankId: 'bank-id',
    transactionReference: 'REF-001',
    amount: '125.5',
    transactionDate: '2026-08-08',
    transactionTime: '12:30:00',
    submissionMethod: 'QR_SCAN' as const,
    businessId: 'business-id',
    branchId: 'branch-id',
    workAssignmentId: 'assignment-id',
    submittedByUserId: 'user-id',
  };
  const row = {
    id: 'transaction-id',
    business_id: 'business-id',
    branch_id: 'branch-id',
    submitted_by_user_id: 'user-id',
    settlement_account_id: 'account-id',
    bank_id: 'bank-id',
    transaction_reference: 'REF-001',
    amount: '125.50',
    transaction_date: '2026-08-08',
    transaction_time: '12:30:00',
    sender_name: null,
    receiver_name: null,
    masked_receiver_account: null,
    submission_method: 'QR_SCAN',
    current_status: 'PROCESSING',
    submission_key: input.idempotencyKey,
    created_at: new Date('2026-08-08T12:30:00.000Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    transaction.mockImplementation((work) => work(boundary));
  });

  it('creates under active assignment/account joins and records initial history', async () => {
    optional.mockResolvedValueOnce(undefined).mockResolvedValueOnce(row);
    execute.mockResolvedValueOnce(1);
    await expect(dao.create(input)).resolves.toMatchObject({ replayed: false });
    expect(optional.mock.calls[1][0]).toContain("account.status = 'ACTIVE'");
    expect(optional.mock.calls[1][0]).toContain("assignment.status = 'ACTIVE'");
    expect(execute.mock.calls[0][0]).toContain('TRANSACTION_SUBMITTED');
  });

  it('returns exact idempotent replay without another history row', async () => {
    optional.mockResolvedValueOnce(row);
    await expect(dao.create(input)).resolves.toMatchObject({ replayed: true });
    expect(execute).not.toHaveBeenCalled();
  });

  it('converts a concurrent insert conflict into an exact replay', async () => {
    optional
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(row);
    await expect(dao.create(input)).resolves.toMatchObject({ replayed: true });
    expect(optional.mock.calls[1][0]).toContain('ON CONFLICT');
    expect(execute).not.toHaveBeenCalled();
  });
});
