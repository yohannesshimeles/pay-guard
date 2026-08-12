import { Injectable } from '@nestjs/common';
import { DaoTransaction } from '../database/central.dao';
import { CreditLifecycleDao } from '../credits/credit-lifecycle.dao';
import { VerifyEtProviderResult } from '../verify-et/verify-et-provider.adapter';
import {
  classifySubscriptionReuse, SubscriptionFraudDao,
  SubscriptionReuseClassification, subscriptionTransactionDateKey,
} from './subscription-fraud.dao';

type MatchRow = {
  order_id: string; business_id: string; branch_id: string; status: string;
  price_snapshot: string; credits_snapshot: string; duration_days_snapshot: number;
  plan_id: string; purchasing_membership_id: string; payment_bank_id: string;
  verifyet_bank_identifier: string; normalized_account_suffix: string | null;
  extraction_state: string; parsed_bank_code: string | null;
  parsed_reference: string | null; parsed_amount_etb: string | null;
  parsed_account_suffix: string | null; parsed_transaction_date: string | null;
  parsed_transaction_time: string | null;
};

type VerificationRow = {
  id: string; order_id: string; idempotency_key: string;
  payment_bank_id: string; transaction_reference: string; amount: string;
  transaction_date: string; transaction_time: string;
  verification_status: 'PENDING' | 'VERIFIED' | 'FAILED' | 'DUPLICATE';
  verifyet_request_id: string | null; provider_status: string | null;
  provider_bank_identifier: string | null;
  provider_transaction_reference: string | null;
  provider_amount: string | null; provider_receiver_suffix: string | null;
  credit_charged: boolean; duplicate_of_verification_id: string | null;
  request_count: number; created_at: Date; updated_at: Date;
};

export class SubscriptionProofMatchError extends Error {}
export class SubscriptionVerificationScopeError extends Error {}
export class SubscriptionVerificationOutcomeConflictError extends Error {}

@Injectable()
export class SubscriptionVerificationDao {
  constructor(
    private readonly credits: CreditLifecycleDao,
    private readonly fraud: SubscriptionFraudDao,
  ) {}

  async prepareWithin(transaction: DaoTransaction, input: {
    id: string; idempotencyKey: string; deferredId: string; creditEventKey: string;
    orderId: string; businessId: string; branchId: string;
  }) {
    const match = await transaction.optional<MatchRow>(
      `SELECT purchase.id AS order_id, purchase.business_id, purchase.branch_id,
        purchase.status, purchase.price_snapshot::text, purchase.credits_snapshot::text,
        purchase.duration_days_snapshot, purchase.plan_id,
        purchase.purchasing_membership_id, purchase.payment_bank_id,
        bank.verifyet_bank_identifier, account.normalized_account_suffix,
        proof.extraction_state, proof.parsed_bank_code, proof.parsed_reference,
        proof.parsed_amount_etb::text, proof.parsed_account_suffix,
        proof.parsed_transaction_date::text, proof.parsed_transaction_time::text
       FROM subscription_orders purchase
       JOIN supported_banks bank ON bank.id = purchase.payment_bank_id
         AND bank.status = 'ACTIVE'
       JOIN platform_settlement_accounts account ON account.id = purchase.platform_account_id
         AND account.bank_id = bank.id AND account.status = 'ACTIVE'
       JOIN subscription_purchase_proofs proof ON proof.order_id = purchase.id
       WHERE purchase.id = $1 AND purchase.business_id = $2 AND purchase.branch_id = $3
         AND purchase.status IN ('PROOF_RECEIVED','VERIFICATION_PENDING')
       FOR UPDATE OF purchase`,
      [input.orderId, input.businessId, input.branchId],
    );
    if (!match) throw new SubscriptionVerificationScopeError();
    this.assertProofMatch(match);
    const existing = await transaction.optional<VerificationRow>(
      `SELECT * FROM subscription_payment_verifications WHERE order_id = $1 FOR UPDATE`,
      [input.orderId],
    );
    if (existing) {
      if (existing.id !== input.id || existing.idempotency_key !== input.idempotencyKey ||
          existing.transaction_reference !== match.parsed_reference ||
          Number(existing.amount) !== Number(match.price_snapshot)) {
        throw new SubscriptionVerificationOutcomeConflictError();
      }
      return { verification: existing, credit: { decision: existing.credit_charged
        ? 'CHARGED' as const : 'DEFERRED' as const, replayed: true },
        request: this.request(match) };
    }
    const credit = await this.credits.prepareSubscriptionVerificationWithin(transaction, {
      deferredId: input.deferredId, eventKey: input.creditEventKey,
      businessId: input.businessId, branchId: input.branchId,
      subscriptionOrderId: input.orderId,
    });
    const verification = await transaction.one<VerificationRow>(
      `INSERT INTO subscription_payment_verifications (
         id, order_id, idempotency_key, payment_bank_id, transaction_reference,
         amount, transaction_date, transaction_time, verification_status,
         credit_charged
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',$9) RETURNING *`,
      [input.id, input.orderId, input.idempotencyKey, match.payment_bank_id,
       match.parsed_reference, match.price_snapshot, match.parsed_transaction_date,
       match.parsed_transaction_time, credit.creditConsumed],
    );
    return { verification, credit, request: this.request(match) };
  }

  async recordOutcomeWithin(transaction: DaoTransaction, input: {
    verificationId: string; orderId: string; businessId: string; branchId: string;
    subscriptionId: string; invoiceId: string; creditLotId: string; creditGrantEventKey: string;
    provider: VerifyEtProviderResult;
  }) {
    const context = await transaction.optional<MatchRow & VerificationRow>(
      `SELECT verification.*, purchase.business_id, purchase.branch_id,
        purchase.status, purchase.price_snapshot::text,
        purchase.credits_snapshot::text, purchase.duration_days_snapshot,
        purchase.plan_id, purchase.purchasing_membership_id,
        verification.transaction_date::text AS transaction_date,
        bank.verifyet_bank_identifier, account.normalized_account_suffix,
        proof.extraction_state, proof.parsed_bank_code, proof.parsed_reference,
        proof.parsed_amount_etb::text, proof.parsed_account_suffix,
        proof.parsed_transaction_date::text, proof.parsed_transaction_time::text
       FROM subscription_payment_verifications verification
       JOIN subscription_orders purchase ON purchase.id = verification.order_id
       JOIN supported_banks bank ON bank.id = purchase.payment_bank_id
       JOIN platform_settlement_accounts account ON account.id = purchase.platform_account_id
       JOIN subscription_purchase_proofs proof ON proof.order_id = purchase.id
       WHERE verification.id = $1 AND verification.order_id = $2
         AND purchase.business_id = $3 AND purchase.branch_id = $4
       FOR UPDATE OF verification, purchase`,
      [input.verificationId, input.orderId, input.businessId, input.branchId],
    );
    if (!context) throw new SubscriptionVerificationScopeError();
    if (context.verification_status !== 'PENDING') {
      this.assertReplay(context, input.provider);
      return { decision: context.verification_status, replayed: true };
    }
    if (input.provider.result === 'PENDING') {
      await this.updateProvider(transaction, context.id, input.provider, 'PENDING');
      return { decision: 'PENDING' as const, replayed: false };
    }
    if (input.provider.result === 'FAILED') {
      await this.updateProvider(transaction, context.id, input.provider, 'FAILED');
      await transaction.execute(`UPDATE subscription_orders SET status = 'FAILED' WHERE id = $1`,
        [input.orderId]);
      return { decision: 'FAILED' as const, replayed: false };
    }
    if (!this.providerMatches(context, input.provider)) {
      await this.updateProvider(transaction, context.id, input.provider, 'FAILED');
      await transaction.execute(`UPDATE subscription_orders SET status = 'FAILED' WHERE id = $1`,
        [input.orderId]);
      return { decision: 'FAILED' as const, replayed: false, reason: 'PROVIDER_MISMATCH' };
    }
    await transaction.execute(
      `SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))`,
      [context.payment_bank_id, context.transaction_reference],
    );
    const duplicate = await transaction.optional<{ id: string; transaction_date: string }>(
      `SELECT id, transaction_date::text FROM subscription_payment_verifications
       WHERE payment_bank_id = $1 AND transaction_reference = $2
         AND verification_status = 'VERIFIED' AND id <> $3
       ORDER BY created_at LIMIT 1 FOR UPDATE`,
      [context.payment_bank_id, context.transaction_reference, context.id],
    );
    if (duplicate) {
      const duplicateClassification = classifySubscriptionReuse(
        duplicate.transaction_date, context.transaction_date,
      );
      await this.updateProvider(transaction, context.id, input.provider, 'DUPLICATE',
        duplicate.id, duplicateClassification);
      await transaction.execute(`UPDATE subscription_orders SET status = 'DUPLICATE' WHERE id = $1`,
        [input.orderId]);
      const fraud = duplicateClassification === 'CROSS_DAY_FRAUD'
        ? await this.fraud.recordCrossDayReuseWithin(transaction, {
          businessId: input.businessId, branchId: input.branchId,
          orderId: input.orderId, verificationId: context.id,
          originalVerificationId: duplicate.id,
          paymentBankId: context.payment_bank_id,
          transactionReference: context.transaction_reference,
          originalTransactionDate: subscriptionTransactionDateKey(
            duplicate.transaction_date,
          ),
          attemptedTransactionDate: subscriptionTransactionDateKey(
            context.transaction_date,
          ),
        })
        : undefined;
      return { decision: 'DUPLICATE' as const, replayed: false,
        duplicateClassification,
        ...(fraud ? { fraudAttemptNumber: fraud.attemptNumber,
          purchaseLocked: fraud.purchaseLocked } : {}) };
    }
    await this.updateProvider(transaction, context.id, input.provider, 'VERIFIED');
    await transaction.execute(`UPDATE subscription_orders SET status = 'VERIFIED' WHERE id = $1`,
      [input.orderId]);
    await transaction.one<{ id: string }>(
      `INSERT INTO business_subscriptions (
         id, business_id, branch_id, order_id, plan_id, credits_allocated,
         price_paid, start_at, expiry_at, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,
         $8::timestamptz + make_interval(days => $9::int),'ACTIVE')
       ON CONFLICT (order_id) DO NOTHING RETURNING id`,
      [input.subscriptionId, input.businessId, input.branchId, input.orderId,
       context.plan_id, context.credits_snapshot, context.price_snapshot,
       input.provider.respondedAt, context.duration_days_snapshot],
    );
    await transaction.one<{ id: string }>(
      `INSERT INTO subscription_invoices (
         id, invoice_number, business_id, branch_id, order_id,
         subscription_id, verification_id, plan_id, plan_name_snapshot,
         credits_snapshot, amount_etb, payment_reference,
         provider_request_id, issued_at
       ) SELECT $1, 'PG-' || upper(replace($2::uuid::text, '-', '')),
         purchase.business_id, purchase.branch_id, purchase.id, $3,
         verification.id, purchase.plan_id, purchase.plan_name_snapshot,
         purchase.credits_snapshot, purchase.price_snapshot,
         verification.transaction_reference, verification.verifyet_request_id, $4
       FROM subscription_orders purchase
       JOIN subscription_payment_verifications verification
         ON verification.order_id = purchase.id
        AND verification.verification_status = 'VERIFIED'
       WHERE purchase.id = $2::uuid AND purchase.status = 'VERIFIED'
       ON CONFLICT (order_id) DO NOTHING RETURNING id`,
      [input.invoiceId, input.orderId, input.subscriptionId,
       input.provider.respondedAt],
    );
    const grant = await this.credits.grantWithin(transaction, {
      id: input.creditLotId, eventKey: input.creditGrantEventKey,
      businessId: input.businessId, branchId: input.branchId,
      subscriptionId: input.subscriptionId,
    });
    return { decision: 'VERIFIED' as const, replayed: false,
      invoiceId: input.invoiceId, grant };
  }

  private assertProofMatch(row: MatchRow) {
    if (row.extraction_state !== 'SINGLE_QR' || !row.parsed_reference ||
        !row.parsed_amount_etb || !row.parsed_account_suffix ||
        !row.parsed_transaction_date || !row.parsed_transaction_time ||
        row.parsed_bank_code !== row.verifyet_bank_identifier ||
        Number(row.parsed_amount_etb) !== Number(row.price_snapshot) ||
        !row.normalized_account_suffix ||
        row.parsed_account_suffix !== row.normalized_account_suffix) {
      throw new SubscriptionProofMatchError();
    }
  }

  private request(row: MatchRow) {
    return {
      bankCode: row.verifyet_bank_identifier,
      transactionReference: row.parsed_reference!, amount: row.price_snapshot,
      receiverAccountSuffix: row.normalized_account_suffix!,
    };
  }

  private providerMatches(row: MatchRow & VerificationRow,
    provider: Extract<VerifyEtProviderResult, { result: 'VERIFIED' }>) {
    return provider.providerBankId === row.verifyet_bank_identifier &&
      provider.transactionReference === row.transaction_reference &&
      Number(provider.amount) === Number(row.amount) &&
      provider.receiverAccountSuffix === row.normalized_account_suffix;
  }

  private async updateProvider(transaction: DaoTransaction, id: string,
    provider: VerifyEtProviderResult, status: VerificationRow['verification_status'],
    duplicateId?: string, duplicateClassification?: SubscriptionReuseClassification) {
    await transaction.one<{ id: string }>(
      `UPDATE subscription_payment_verifications SET
         verification_status = $2::varchar, verifyet_request_id = $3,
         provider_status = $4, request_count = request_count + 1,
         last_requested_at = $5, last_responded_at = $6,
         provider_bank_identifier = $7,
         provider_transaction_reference = $8, provider_amount = $9,
         provider_receiver_suffix = $10, provider_transaction_at = $11,
         verified_at = CASE WHEN $2::varchar = 'VERIFIED' THEN $6 ELSE verified_at END,
         duplicate_of_verification_id = $12, duplicate_classification = $13
       WHERE id = $1 RETURNING id`,
      [id, status, provider.providerRequestId, provider.providerStatus,
       provider.requestedAt, provider.respondedAt,
       provider.result === 'VERIFIED' ? provider.providerBankId : null,
       provider.result === 'VERIFIED' ? provider.transactionReference : null,
       provider.result === 'VERIFIED' ? provider.amount : null,
       provider.result === 'VERIFIED' ? provider.receiverAccountSuffix : null,
       provider.result === 'VERIFIED' ? provider.providerTransactionAt : null,
       duplicateId ?? null, duplicateClassification ?? null],
    );
  }

  private assertReplay(row: VerificationRow, provider: VerifyEtProviderResult) {
    const matches = row.verifyet_request_id === provider.providerRequestId &&
      row.provider_status === provider.providerStatus &&
      (provider.result !== 'VERIFIED' || (
        row.provider_bank_identifier === provider.providerBankId &&
        row.provider_transaction_reference === provider.transactionReference &&
        Number(row.provider_amount) === Number(provider.amount) &&
        row.provider_receiver_suffix === provider.receiverAccountSuffix));
    if (!matches) throw new SubscriptionVerificationOutcomeConflictError();
  }
}
