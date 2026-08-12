import { CentralDao, DaoTransaction } from '../../src/database/central.dao';
import {
  VerifyEtWebhookDeliveryConflictError,
  VerifyEtWebhookDeliveryDao,
} from '../../src/verify-et/verify-et-webhook-delivery.dao';

const now = new Date('2026-08-06T12:00:00.000Z');
const deliveryRow = {
  id: 'delivery-record-id',
  delivery_id: 'delivery:provider:12345',
  event_type: 'verification.completed',
  payload_hash: 'a'.repeat(64),
  delivery_status: 'RECEIVED' as const,
  processing_attempts: 0,
  last_error_code: null,
  signature_verified_at: now,
  first_received_at: now,
  processing_started_at: null,
  processed_at: null,
  updated_at: now,
};

describe('VerifyEtWebhookDeliveryDao', () => {
  const optional = jest.fn<
    Promise<unknown>,
    [text: string, values?: readonly unknown[]]
  >();
  const transactionOne = jest.fn<
    Promise<unknown>,
    [text: string, values?: readonly unknown[]]
  >();
  const one = jest.fn<
    Promise<unknown>,
    [text: string, values?: readonly unknown[]]
  >();
  const transaction = jest.fn<
    Promise<unknown>,
    [(current: DaoTransaction) => Promise<unknown>]
  >((work) =>
    work({ optional, one: transactionOne } as unknown as DaoTransaction),
  );
  const centralDao = { optional, one, transaction } as unknown as CentralDao;
  const deliveries = new VerifyEtWebhookDeliveryDao(centralDao);
  const input = {
    deliveryId: deliveryRow.delivery_id,
    eventType: deliveryRow.event_type,
    rawBody: Buffer.from('{"private":"do-not-store"}', 'utf8'),
    maxPayloadBytes: 65_536,
  };

  beforeEach(() => jest.clearAllMocks());

  it('reserves a verified delivery without retaining its raw body', async () => {
    optional.mockImplementationOnce((_sql, values = []) =>
      Promise.resolve({ ...deliveryRow, payload_hash: values[2] }),
    );

    await expect(deliveries.reserveVerified(input)).resolves.toMatchObject({
      duplicate: false,
      delivery: { deliveryId: input.deliveryId, status: 'RECEIVED' },
    });
    const values = optional.mock.calls[0][1] ?? [];
    expect(values[2]).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(values)).not.toContain('do-not-store');
    expect(transactionOne).not.toHaveBeenCalled();
  });

  it('recognizes an exact duplicate under a row lock', async () => {
    optional.mockResolvedValue(undefined);
    transactionOne.mockImplementationOnce((_sql, values = []) => {
      const insertedValues = optional.mock.calls[0][1] ?? [];
      return Promise.resolve({
        ...deliveryRow,
        delivery_id: values[0],
        payload_hash: insertedValues[2],
      });
    });

    await expect(deliveries.reserveVerified(input)).resolves.toMatchObject({
      duplicate: true,
    });
    expect(transactionOne.mock.calls[0][0]).toContain('FOR UPDATE');
  });

  it.each([
    ['event type', { event_type: 'verification.failed' }],
    ['payload', { payload_hash: 'b'.repeat(64) }],
  ])('rejects delivery-ID reuse with different %s', async (_label, change) => {
    optional.mockResolvedValue(undefined);
    transactionOne.mockResolvedValue({ ...deliveryRow, ...change });

    await expect(deliveries.reserveVerified(input)).rejects.toBeInstanceOf(
      VerifyEtWebhookDeliveryConflictError,
    );
  });

  it('validates signed metadata and size before database access', () => {
    expect(() =>
      deliveries.reserveVerified({ ...input, deliveryId: 'short' }),
    ).toThrow('delivery identifier is invalid');
    expect(() =>
      deliveries.reserveVerified({ ...input, eventType: 'contains spaces' }),
    ).toThrow('event type is invalid');
    expect(() =>
      deliveries.reserveVerified({ ...input, maxPayloadBytes: 4 }),
    ).toThrow('payload exceeds the hashing limit');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('claims only received or failed deliveries for one processor', async () => {
    optional.mockResolvedValue({
      ...deliveryRow,
      delivery_status: 'PROCESSING',
      processing_attempts: 1,
      processing_started_at: now,
    });

    await expect(deliveries.claim(deliveryRow.id)).resolves.toMatchObject({
      status: 'PROCESSING',
      processingAttempts: 1,
    });
    expect(optional.mock.calls[0][0]).toContain(
      "delivery_status IN ('RECEIVED','FAILED')",
    );

    optional.mockResolvedValueOnce(undefined);
    await expect(deliveries.claim(deliveryRow.id)).resolves.toBeUndefined();
  });

  it('finishes only a currently processing delivery', async () => {
    one.mockResolvedValue({
      ...deliveryRow,
      delivery_status: 'PROCESSED',
      processing_attempts: 1,
      processed_at: now,
    });

    await expect(
      deliveries.finish(deliveryRow.id, { succeeded: true }),
    ).resolves.toMatchObject({ status: 'PROCESSED', processedAt: now });
    expect(one.mock.calls[0][0]).toContain("delivery_status = 'PROCESSING'");
  });

  it('requires a sanitized error code for failed processing', async () => {
    await expect(
      deliveries.finish(deliveryRow.id, { succeeded: false }),
    ).rejects.toThrow('requires an error code');
    await expect(
      deliveries.finish(deliveryRow.id, {
        succeeded: false,
        errorCode: 'unsafe error detail',
      }),
    ).rejects.toThrow('error code is invalid');
    await expect(
      deliveries.finish(deliveryRow.id, {
        succeeded: true,
        errorCode: 'SHOULD_NOT_EXIST',
      }),
    ).rejects.toThrow('cannot have an error code');
    expect(one).not.toHaveBeenCalled();
  });
});
