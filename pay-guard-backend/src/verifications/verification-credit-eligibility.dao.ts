import { Injectable } from '@nestjs/common';
import { CentralDao, DaoTransaction } from '../database/central.dao';
import { CustomerTransactionStatus } from './enums/customer-transaction-status.enum';
import { VerificationAttemptType } from './enums/verification-attempt-type.enum';
import { VerificationEligibilityModel } from './models/verification-eligibility.model';

type VerificationScopeRow = {
  transaction_status: CustomerTransactionStatus;
  business_status: string;
  branch_status: string;
};

type CreditTransactionRow = {
  id: string;
  balance_before: string;
  balance_after: string;
};

type WalletDebitRow = {
  balance_before: string;
  balance_after: string;
  active_subscription_id: string | null;
  credit_lot_id: string;
};

export class VerificationCreditPolicyPendingError extends Error {
  readonly name = 'VerificationCreditPolicyPendingError';

  constructor() {
    super('Verification credit policy is not approved for this attempt type');
  }
}

export type ResolveVerificationCreditEligibility = {
  transactionId: string;
  businessId: string;
  branchId: string;
  attemptType: VerificationAttemptType;
};

@Injectable()
export class VerificationCreditEligibilityDao {
  constructor(private readonly dao: CentralDao) {}

  resolve(
    input: ResolveVerificationCreditEligibility,
  ): Promise<VerificationEligibilityModel> {
    this.assertSupportedAttemptType(input.attemptType);
    return this.dao.transaction((transaction) =>
      this.resolveWithin(transaction, input),
    );
  }

  async resolveWithin(
    transaction: DaoTransaction,
    input: ResolveVerificationCreditEligibility,
  ): Promise<VerificationEligibilityModel> {
    this.assertSupportedAttemptType(input.attemptType);
    const scope = await transaction.one<VerificationScopeRow>(
      `SELECT current_transaction.current_status AS transaction_status,
              business.status AS business_status,
              branch.status AS branch_status
       FROM customer_transactions current_transaction
       JOIN businesses business ON business.id = current_transaction.business_id
       JOIN branches branch ON branch.id = current_transaction.branch_id
       WHERE current_transaction.id = $1
         AND current_transaction.business_id = $2
         AND current_transaction.branch_id = $3
         AND branch.business_id = $2
       FOR UPDATE OF current_transaction, business, branch`,
      [input.transactionId, input.businessId, input.branchId],
    );

    if (
      scope.business_status !== 'ACTIVE' ||
      scope.branch_status !== 'ACTIVE'
    ) {
      return {
        decision: 'PAUSED_BRANCH',
        transactionStatus: scope.transaction_status,
        creditConsumed: false,
        replayed: false,
      };
    }

    const existing = await transaction.optional<CreditTransactionRow>(
      `SELECT id, balance_before, balance_after
       FROM credit_transactions
       WHERE related_record_type = 'CUSTOMER_TRANSACTION'
         AND related_record_id = $1
         AND movement_type = 'VERIFICATION_DEDUCTION'`,
      [input.transactionId],
    );

    if (input.attemptType === VerificationAttemptType.RECHECK) {
      if (scope.transaction_status !== CustomerTransactionStatus.PENDING) {
        throw new Error('Verification recheck requires a pending transaction');
      }
      if (!existing) {
        throw new Error(
          'Verification recheck requires an initial credit event',
        );
      }
      return {
        decision: 'ELIGIBLE',
        transactionStatus: scope.transaction_status,
        creditConsumed: false,
        replayed: true,
        creditTransactionId: existing.id,
        balanceBefore: Number(existing.balance_before),
        balanceAfter: Number(existing.balance_after),
      };
    }

    if (
      ![
        CustomerTransactionStatus.PROCESSING,
        CustomerTransactionStatus.WAITING_CREDITS,
        CustomerTransactionStatus.PAUSED_BRANCH,
      ].includes(scope.transaction_status)
    ) {
      throw new Error('Initial verification transaction cannot be prepared');
    }
    if (existing) {
      return {
        decision: 'ELIGIBLE',
        transactionStatus: scope.transaction_status,
        creditConsumed: false,
        replayed: true,
        creditTransactionId: existing.id,
        balanceBefore: Number(existing.balance_before),
        balanceAfter: Number(existing.balance_after),
      };
    }

    const wallet = await transaction.optional<WalletDebitRow>(
      `WITH selected AS (
         SELECT lot.id, COALESCE(lot.subscription_id,
                  wallet.active_subscription_id) AS active_subscription_id
         FROM branch_credit_wallets wallet
         JOIN credit_lots lot ON lot.branch_id = wallet.branch_id
          AND lot.business_id = wallet.business_id
         WHERE wallet.branch_id = $1 AND wallet.business_id = $2
           AND wallet.available_credits > 0
           AND lot.status = 'ACTIVE' AND lot.remaining_credits > 0
           AND lot.starts_at <= now() AND lot.expires_at > now()
         ORDER BY lot.expires_at, lot.created_at, lot.id
         LIMIT 1
         FOR UPDATE OF wallet, lot
       ), used_lot AS (
         UPDATE credit_lots lot
         SET used_credits = lot.used_credits + 1,
             status = CASE WHEN lot.remaining_credits = 1
                           THEN 'EXHAUSTED' ELSE lot.status END,
             updated_at = now()
         FROM selected WHERE lot.id = selected.id
         RETURNING lot.id
       )
       UPDATE branch_credit_wallets wallet
       SET used_credits = wallet.used_credits + 1,
           available_credits = wallet.available_credits - 1,
           updated_at = now()
       FROM selected, used_lot
       WHERE wallet.branch_id = $1 AND wallet.business_id = $2
       RETURNING (wallet.available_credits + 1)::text AS balance_before,
                 wallet.available_credits::text AS balance_after,
                 selected.active_subscription_id,
                 used_lot.id AS credit_lot_id`,
      [input.branchId, input.businessId],
    );
    if (!wallet) {
      return {
        decision: 'WAITING_CREDITS',
        transactionStatus: scope.transaction_status,
        creditConsumed: false,
        replayed: false,
      };
    }

    const credit = await transaction.one<CreditTransactionRow>(
      `INSERT INTO credit_transactions (
         business_id, branch_id, subscription_id, credit_lot_id, movement_type,
         credit_delta, balance_before, balance_after,
         related_record_type, related_record_id, credit_event_key, reason
       ) VALUES (
         $1, $2, $3, $4, 'VERIFICATION_DEDUCTION', -1, $5, $6,
         'CUSTOMER_TRANSACTION', $7, $8, 'INITIAL_VERIFICATION'
       ) RETURNING id, balance_before, balance_after`,
      [
        input.businessId,
        input.branchId,
        wallet.active_subscription_id,
        wallet.credit_lot_id,
        wallet.balance_before,
        wallet.balance_after,
        input.transactionId,
        `verification:initial:${input.transactionId}`,
      ],
    );
    await transaction.execute(
      `INSERT INTO credit_usage_alerts (
         business_id, branch_id, credit_lot_id, threshold_percent,
         used_credits, expired_credits, allocated_credits, trigger_event_id
       ) SELECT lot.business_id, lot.branch_id, lot.id, threshold,
                lot.used_credits, lot.expired_credits,
                lot.allocated_credits, $2
         FROM credit_lots lot
         CROSS JOIN unnest(ARRAY[75,90,100]::smallint[]) threshold
         WHERE lot.id = $1
           AND ((lot.used_credits + lot.expired_credits) * 100) >=
               (lot.allocated_credits * threshold)
       ON CONFLICT (credit_lot_id, threshold_percent) DO NOTHING`,
      [wallet.credit_lot_id, credit.id],
    );
    return {
      decision: 'ELIGIBLE',
      transactionStatus: scope.transaction_status,
      creditConsumed: true,
      replayed: false,
      creditTransactionId: credit.id,
      balanceBefore: Number(credit.balance_before),
      balanceAfter: Number(credit.balance_after),
    };
  }

  private assertSupportedAttemptType(
    attemptType: VerificationAttemptType,
  ): void {
    if (
      attemptType !== VerificationAttemptType.INITIAL &&
      attemptType !== VerificationAttemptType.RECHECK
    ) {
      throw new VerificationCreditPolicyPendingError();
    }
  }
}
