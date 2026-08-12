import { CentralDao, DaoTransaction } from '../../src/database/central.dao';
import {
  ReceiptMatchDecisionConflictError,
  ReceiptMatchDecisionDao,
} from '../../src/qr-processing/receipt-match-decision.dao';

describe('ReceiptMatchDecisionDao', () => {
  const execute = jest.fn<
    Promise<number>,
    [text: string, values?: readonly unknown[]]
  >();
  const one = jest.fn<
    Promise<unknown>,
    [text: string, values?: readonly unknown[]]
  >();
  const boundary = { execute, one } as unknown as DaoTransaction;
  const transaction = jest.fn<
    Promise<unknown>,
    [(work: DaoTransaction) => Promise<unknown>]
  >((work) => work(boundary));
  const dao = new ReceiptMatchDecisionDao({
    transaction,
  } as unknown as CentralDao);
  const createdAt = new Date('2026-08-08T10:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    transaction.mockImplementation((work) => work(boundary));
  });

  it('persists only a sanitized matched decision', async () => {
    execute.mockResolvedValueOnce(1);
    one.mockResolvedValueOnce({
      id: 'decision-id',
      receipt_id: 'receipt-id',
      transaction_id: 'transaction-id',
      decision: 'MATCHED',
      reason_code: null,
      created_at: createdAt,
    });
    await expect(
      dao.record({
        receiptId: 'receipt-id',
        transactionId: 'transaction-id',
        decision: 'MATCHED',
      }),
    ).resolves.toMatchObject({ decision: 'MATCHED' });
    expect(execute.mock.calls[0][1]).toEqual([
      'receipt-id',
      'transaction-id',
      'MATCHED',
      null,
    ]);
  });

  it('allows exact replay and rejects changed replay', async () => {
    execute.mockResolvedValue(0);
    one.mockResolvedValue({
      id: 'decision-id',
      receipt_id: 'receipt-id',
      transaction_id: 'transaction-id',
      decision: 'REVIEW_REQUIRED',
      reason_code: 'AMOUNT_MISMATCH',
      created_at: createdAt,
    });
    one.mockImplementation((text) =>
      text.includes('FROM receipt_match_decisions')
        ? Promise.resolve({
            id: 'decision-id', receipt_id: 'receipt-id',
            transaction_id: 'transaction-id', decision: 'REVIEW_REQUIRED',
            reason_code: 'AMOUNT_MISMATCH', created_at: createdAt,
          })
        : Promise.resolve({ id: 'case-id' }),
    );
    const input = {
      receiptId: 'receipt-id',
      transactionId: 'transaction-id',
      decision: 'REVIEW_REQUIRED' as const,
      reasonCode: 'AMOUNT_MISMATCH' as const,
    };
    await expect(dao.record(input)).resolves.toMatchObject(input);
    await expect(
      dao.record({ ...input, reasonCode: 'DATE_MISMATCH' }),
    ).rejects.toBeInstanceOf(ReceiptMatchDecisionConflictError);
  });

  it('rejects inconsistent decision/reason input before database access', async () => {
    await expect(
      dao.record({
        receiptId: 'receipt-id',
        transactionId: 'transaction-id',
        decision: 'MATCHED',
        reasonCode: 'NO_QR',
      }),
    ).rejects.toThrow('inconsistent');
    expect(execute).not.toHaveBeenCalled();
  });
});
