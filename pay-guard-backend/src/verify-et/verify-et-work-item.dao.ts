import { Injectable } from '@nestjs/common';
import { CentralDao } from '../database/central.dao';

type WorkItemRow = {
  verification_attempt_id: string;
  attempt_key: string;
  bank_id: string;
  bank_code: string;
  transaction_reference: string;
  amount: string;
  receiver_account_suffix: string | null;
  provider_request_id: string | null;
};

export type VerifyEtWorkItem = Readonly<{
  verificationAttemptId: string;
  attemptKey: string;
  bankId: string;
  bankCode: string;
  transactionReference: string;
  amount: string;
  receiverAccountSuffix: string;
  providerRequestId?: string;
}>;

@Injectable()
export class VerifyEtWorkItemDao {
  constructor(private readonly dao: CentralDao) {}

  async requireByAttemptId(attemptId: string): Promise<VerifyEtWorkItem> {
    const row = await this.dao.one<WorkItemRow>(
      `SELECT attempt.id AS verification_attempt_id,
              attempt.attempt_key,
              bank.id AS bank_id,
              bank.verifyet_bank_identifier AS bank_code,
              customer_transaction.transaction_reference,
              customer_transaction.amount::text,
              account.normalized_account_suffix AS receiver_account_suffix,
              prior_provider.provider_request_id
       FROM verification_attempts attempt
       JOIN customer_transactions customer_transaction
         ON customer_transaction.id = attempt.transaction_id
       JOIN supported_banks bank ON bank.id = customer_transaction.bank_id
       JOIN settlement_accounts account
         ON account.id = customer_transaction.settlement_account_id
       LEFT JOIN LATERAL (
         SELECT request.provider_request_id
         FROM verifyet_provider_requests request
         JOIN verification_attempts prior_attempt
           ON prior_attempt.id = request.verification_attempt_id
         WHERE prior_attempt.transaction_id = attempt.transaction_id
           AND request.provider_request_id IS NOT NULL
         ORDER BY request.completed_at DESC NULLS LAST, request.created_at DESC
         LIMIT 1
       ) prior_provider ON true
       WHERE attempt.id = $1`,
      [attemptId],
    );
    if (!row.receiver_account_suffix) {
      throw new Error('Verification work item has no receiver account suffix');
    }
    return {
      verificationAttemptId: row.verification_attempt_id,
      attemptKey: row.attempt_key,
      bankId: row.bank_id,
      bankCode: row.bank_code,
      transactionReference: row.transaction_reference,
      amount: row.amount,
      receiverAccountSuffix: row.receiver_account_suffix,
      providerRequestId: row.provider_request_id ?? undefined,
    };
  }
}
