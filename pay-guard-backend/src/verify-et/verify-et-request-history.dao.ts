import { Injectable } from '@nestjs/common';
import { CentralDao, DaoTransaction } from '../database/central.dao';
import { hashVerifyEtPayload } from './verify-et-payload-hash';

export const VERIFYET_OPERATIONS = [
  'SUBMIT',
  'STATUS',
  'EVENTS',
  'HISTORY',
  'TEST_WEBHOOK',
] as const;
export type VerifyEtOperation = (typeof VERIFYET_OPERATIONS)[number];

export type VerifyEtRequestStatus =
  'RESERVED' | 'SENT' | 'SUCCEEDED' | 'FAILED';

type RequestRow = {
  id: string;
  verification_attempt_id: string;
  operation: VerifyEtOperation;
  idempotency_key: string;
  request_hash: string;
  bank_code: string | null;
  amount_etb: string | null;
  request_status: VerifyEtRequestStatus;
  provider_request_id: string | null;
  attempt_count: number;
  last_error_code: string | null;
  created_at: Date;
  sent_at: Date | null;
  completed_at: Date | null;
};

type ResponseRow = {
  id: string;
  provider_request_record_id: string;
  http_status: number;
  provider_status: string | null;
  response_hash: string;
  error_code: string | null;
  received_at: Date;
};

export type VerifyEtRequestRecord = {
  id: string;
  verificationAttemptId: string;
  operation: VerifyEtOperation;
  idempotencyKey: string;
  requestHash: string;
  bankCode?: string;
  amountEtb?: string;
  status: VerifyEtRequestStatus;
  providerRequestId?: string;
  attemptCount: number;
  lastErrorCode?: string;
  createdAt: Date;
  sentAt?: Date;
  completedAt?: Date;
};

export type VerifyEtResponseRecord = {
  id: string;
  providerRequestRecordId: string;
  httpStatus: number;
  providerStatus?: string;
  responseHash: string;
  errorCode?: string;
  receivedAt: Date;
};

export type ReserveVerifyEtRequest = {
  verificationAttemptId: string;
  operation: VerifyEtOperation;
  idempotencyKey: string;
  payload: unknown;
  bankCode?: string;
  amountEtb?: string;
};

export type CompleteVerifyEtRequest = {
  requestRecordId: string;
  httpStatus: number;
  responsePayload: unknown;
  providerStatus?: string;
  providerRequestId?: string;
  errorCode?: string;
  succeeded: boolean;
};

export class VerifyEtIdempotencyConflictError extends Error {
  readonly name = 'VerifyEtIdempotencyConflictError';

  constructor() {
    super('Verify.ET idempotency key conflicts with an existing request');
  }
}

@Injectable()
export class VerifyEtRequestHistoryDao {
  constructor(private readonly dao: CentralDao) {}

  reserve(
    input: ReserveVerifyEtRequest,
  ): Promise<{ record: VerifyEtRequestRecord; replayed: boolean }> {
    if (!VERIFYET_OPERATIONS.includes(input.operation)) {
      throw new Error('Verify.ET operation is invalid');
    }
    this.validateIdempotencyKey(input.idempotencyKey);
    const requestHash = hashVerifyEtPayload(input.payload);
    return this.dao.transaction(async (transaction) => {
      const inserted = await transaction.optional<RequestRow>(
        `INSERT INTO verifyet_provider_requests (
           verification_attempt_id, operation, idempotency_key, request_hash,
           bank_code, amount_etb
         ) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING *`,
        [
          input.verificationAttemptId,
          input.operation,
          input.idempotencyKey,
          requestHash,
          input.bankCode ?? null,
          input.amountEtb ?? null,
        ],
      );
      if (inserted)
        return { record: this.mapRequest(inserted), replayed: false };

      const existing = await transaction.one<RequestRow>(
        `SELECT * FROM verifyet_provider_requests
         WHERE idempotency_key = $1
         FOR UPDATE`,
        [input.idempotencyKey],
      );
      if (
        existing.verification_attempt_id !== input.verificationAttemptId ||
        existing.operation !== input.operation ||
        existing.request_hash !== requestHash
      ) {
        throw new VerifyEtIdempotencyConflictError();
      }
      return { record: this.mapRequest(existing), replayed: true };
    });
  }

  complete(input: CompleteVerifyEtRequest): Promise<VerifyEtResponseRecord> {
    if (input.httpStatus < 100 || input.httpStatus > 599) {
      throw new Error('Verify.ET response status is invalid');
    }
    const responseHash = hashVerifyEtPayload(input.responsePayload);
    return this.dao.transaction(async (transaction) => {
      const response = await transaction.one<ResponseRow>(
        `INSERT INTO verifyet_provider_responses (
           provider_request_record_id, http_status, provider_status,
           response_hash, error_code
         ) VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          input.requestRecordId,
          input.httpStatus,
          input.providerStatus ?? null,
          responseHash,
          input.errorCode ?? null,
        ],
      );
      await this.updateCompletion(transaction, input);
      return this.mapResponse(response);
    });
  }

  async markSent(requestRecordId: string): Promise<VerifyEtRequestRecord> {
    const row = await this.dao.one<RequestRow>(
      `UPDATE verifyet_provider_requests
       SET request_status = 'SENT',
           attempt_count = attempt_count + 1,
           sent_at = COALESCE(sent_at, now()),
           completed_at = NULL,
           last_error_code = NULL
       WHERE id = $1
         AND request_status IN ('RESERVED','SENT','FAILED')
       RETURNING *`,
      [requestRecordId],
    );
    return this.mapRequest(row);
  }

  private async updateCompletion(
    transaction: DaoTransaction,
    input: CompleteVerifyEtRequest,
  ): Promise<void> {
    await transaction.one<RequestRow>(
      `UPDATE verifyet_provider_requests
       SET request_status = $2,
           provider_request_id = COALESCE(provider_request_id, $3),
           last_error_code = $4,
           completed_at = now()
       WHERE id = $1
         AND (provider_request_id IS NULL OR $3 IS NULL OR provider_request_id = $3)
       RETURNING *`,
      [
        input.requestRecordId,
        input.succeeded ? 'SUCCEEDED' : 'FAILED',
        input.providerRequestId ?? null,
        input.errorCode ?? null,
      ],
    );
  }

  private validateIdempotencyKey(value: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u.test(value)) {
      throw new Error('Verify.ET idempotency key is invalid');
    }
  }

  private mapRequest(row: RequestRow): VerifyEtRequestRecord {
    return {
      id: row.id,
      verificationAttemptId: row.verification_attempt_id,
      operation: row.operation,
      idempotencyKey: row.idempotency_key,
      requestHash: row.request_hash,
      bankCode: row.bank_code ?? undefined,
      amountEtb: row.amount_etb ?? undefined,
      status: row.request_status,
      providerRequestId: row.provider_request_id ?? undefined,
      attemptCount: row.attempt_count,
      lastErrorCode: row.last_error_code ?? undefined,
      createdAt: row.created_at,
      sentAt: row.sent_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
    };
  }

  private mapResponse(row: ResponseRow): VerifyEtResponseRecord {
    return {
      id: row.id,
      providerRequestRecordId: row.provider_request_record_id,
      httpStatus: row.http_status,
      providerStatus: row.provider_status ?? undefined,
      responseHash: row.response_hash,
      errorCode: row.error_code ?? undefined,
      receivedAt: row.received_at,
    };
  }
}
