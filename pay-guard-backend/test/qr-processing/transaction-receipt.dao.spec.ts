import { CentralDao } from '../../src/database/central.dao';
import { ProofMimeType } from '../../src/qr-processing/enums/proof-mime-type.enum';
import { TransactionReceiptDao } from '../../src/qr-processing/transaction-receipt.dao';

const row = {
  id: '00000000-0000-4000-8000-000000000001',
  transaction_id: '00000000-0000-4000-8000-000000000002',
  storage_object_key: 'private/transaction-receipts/proof.pdf',
  file_name: 'proof.pdf',
  mime_type: ProofMimeType.PDF,
  file_size_bytes: '1234',
  file_hash: 'a'.repeat(64),
  submitted_by_user_id: '00000000-0000-4000-8000-000000000003',
  created_at: new Date('2025-08-05T00:00:00.000Z'),
  archived_at: null,
};

describe('TransactionReceiptDao retention boundaries', () => {
  const many = jest.fn();
  const dao = new TransactionReceiptDao({ many } as unknown as CentralDao);

  beforeEach(() => jest.clearAllMocks());

  it('excludes archived evidence from operational transaction queries', async () => {
    many.mockResolvedValue([row]);

    const result = await dao.listByTransactionId(row.transaction_id);

    expect(many).toHaveBeenCalledWith(
      expect.stringContaining('AND archived_at IS NULL'),
      [row.transaction_id],
    );
    expect(result[0]).toMatchObject({
      id: row.id,
      archivedAt: undefined,
    });
  });

  it('selects only active receipts older than one full year using bound values', async () => {
    many.mockResolvedValue([row]);
    const referenceTime = new Date('2026-08-06T00:00:00.000Z');

    const result = await dao.listArchiveEligible(referenceTime, 50);

    expect(many).toHaveBeenCalledWith(
      expect.stringMatching(
        /archived_at IS NULL[\s\S]*created_at < \$1::timestamptz - interval '1 year'/u,
      ),
      [referenceTime, 50],
    );
    expect(result).toHaveLength(1);
  });

  it('rejects invalid eligibility dates and unbounded batch sizes', async () => {
    await expect(dao.listArchiveEligible(new Date(Number.NaN))).rejects.toThrow(
      'Archive reference time must be valid',
    );
    await expect(
      dao.listArchiveEligible(new Date('2026-08-06T00:00:00.000Z'), 501),
    ).rejects.toThrow('Archive eligibility limit must be between 1 and 500');
    expect(many).not.toHaveBeenCalled();
  });
});
