import { Injectable } from '@nestjs/common';
import { CentralDao, DaoTransaction } from '../database/central.dao';
import { NotificationAudienceDao } from '../notifications/notification-audience.dao';

type SubscriptionRow = {
  subscription_id: string;
  order_id: string;
  credits_allocated: string;
  start_at: Date;
  expiry_at: Date;
};
type DeferredRow = {
  id: string;
  business_id: string;
  branch_id: string;
  subscription_order_id: string;
  deferred_event_id: string;
  credit_event_key: string;
  status: 'PENDING' | 'SETTLED' | 'CANCELLED';
};
type SettledDeferredRow = {
  deferred_id: string;
  settlement_event_id: string;
  balance_after: string;
};
type WalletRow = {
  purchased_credits: string;
  available_credits: string;
};
type GrantReplayRow = {
  event_id: string;
  credit_event_key: string;
  credit_lot_id: string;
  business_id: string;
  branch_id: string;
  subscription_id: string | null;
  credit_delta: string;
  balance_before: string;
  balance_after: string;
  expires_at: Date;
};
type DueLotRow = {
  id: string;
  business_id: string;
  branch_id: string;
  remaining_credits: string;
  used_credits: string;
  allocated_credits: string;
};

export type GrantSubscriptionCredits = Readonly<{
  id: string;
  eventKey: string;
  businessId: string;
  branchId: string;
  subscriptionId: string;
}>;
export type DeferSubscriptionVerification = Readonly<{
  id: string;
  eventKey: string;
  businessId: string;
  branchId: string;
  subscriptionOrderId: string;
}>;
export type PrepareSubscriptionVerificationCredit = Readonly<{
  deferredId: string;
  eventKey: string;
  businessId: string;
  branchId: string;
  subscriptionOrderId: string;
}>;

export class CreditGrantScopeError extends Error {}
export class CreditGrantReplayConflictError extends Error {}
export class CreditDeferralScopeError extends Error {}
export class CreditDeferralBalanceError extends Error {}
export class CreditDeferralReplayConflictError extends Error {}

@Injectable()
export class CreditLifecycleDao {
  constructor(
    private readonly dao: CentralDao,
    private readonly notifications: NotificationAudienceDao,
  ) {}

  grant(input: GrantSubscriptionCredits) {
    return this.dao.transaction((transaction) =>
      this.grantWithin(transaction, input),
    );
  }

  async deferSubscriptionWithin(
    transaction: DaoTransaction,
    input: DeferSubscriptionVerification,
  ) {
    await transaction.execute(
      `INSERT INTO branch_credit_wallets (branch_id, business_id)
       VALUES ($1,$2) ON CONFLICT (branch_id) DO NOTHING`,
      [input.branchId, input.businessId],
    );
    const scope = await transaction.optional<{
      order_status: string;
      available_credits: string;
    }>(
      `SELECT purchase.status AS order_status,
              wallet.available_credits::text
       FROM subscription_orders purchase
       JOIN branches branch ON branch.id = purchase.branch_id
        AND branch.business_id = purchase.business_id AND branch.status = 'ACTIVE'
       JOIN branch_credit_wallets wallet ON wallet.branch_id = purchase.branch_id
        AND wallet.business_id = purchase.business_id
       WHERE purchase.id = $1 AND purchase.business_id = $2
         AND purchase.branch_id = $3
         AND purchase.status IN ('ORDER_CREATED','PROOF_RECEIVED','VERIFICATION_PENDING')
       FOR UPDATE OF purchase, wallet`,
      [input.subscriptionOrderId, input.businessId, input.branchId],
    );
    if (!scope) throw new CreditDeferralScopeError();
    const existing = await transaction.optional<DeferredRow>(
      `SELECT deferred.id, deferred.business_id, deferred.branch_id,
              deferred.subscription_order_id, deferred.deferred_event_id,
              event.credit_event_key, deferred.status
       FROM deferred_credit_deductions deferred
       JOIN credit_transactions event ON event.id = deferred.deferred_event_id
       WHERE deferred.id = $1 OR deferred.subscription_order_id = $2
          OR event.credit_event_key = $3
       ORDER BY (deferred.id = $1 AND deferred.subscription_order_id = $2
                 AND event.credit_event_key = $3) DESC
       LIMIT 1 FOR UPDATE OF deferred, event`,
      [input.id, input.subscriptionOrderId, input.eventKey],
    );
    if (existing) {
      if (
        existing.id !== input.id ||
        existing.business_id !== input.businessId ||
        existing.branch_id !== input.branchId ||
        existing.subscription_order_id !== input.subscriptionOrderId ||
        existing.credit_event_key !== input.eventKey ||
        existing.status !== 'PENDING'
      ) {
        throw new CreditDeferralReplayConflictError();
      }
      return {
        deferredDeductionId: existing.id,
        eventId: existing.deferred_event_id,
        balance: Number(scope.available_credits),
        replayed: true,
      };
    }
    if (scope.available_credits !== '0') throw new CreditDeferralBalanceError();
    const event = await transaction.one<{ id: string }>(
      `INSERT INTO credit_transactions (
         business_id, branch_id, movement_type, credit_delta,
         balance_before, balance_after, related_record_type,
         related_record_id, credit_event_key, reason
       ) VALUES ($1,$2,'SUBSCRIPTION_VERIFICATION_DEFERRED',0,0,0,
         'SUBSCRIPTION_ORDER',$3,$4,'ZERO_CREDIT_SUBSCRIPTION_VERIFICATION')
       RETURNING id`,
      [
        input.businessId, input.branchId, input.subscriptionOrderId,
        input.eventKey,
      ],
    );
    await transaction.one<{ id: string }>(
      `INSERT INTO deferred_credit_deductions (
         id, business_id, branch_id, subscription_order_id,
         deferred_event_id, reason
       ) VALUES ($1,$2,$3,$4,$5,'ZERO_CREDIT_SUBSCRIPTION_VERIFICATION')
       RETURNING id`,
      [
        input.id, input.businessId, input.branchId,
        input.subscriptionOrderId, event.id,
      ],
    );
    await transaction.one<{ id: string }>(
      `UPDATE subscription_orders SET status = 'VERIFICATION_PENDING'
       WHERE id = $1 RETURNING id`,
      [input.subscriptionOrderId],
    );
    return {
      deferredDeductionId: input.id,
      eventId: event.id,
      balance: 0,
      replayed: false,
    };
  }

  async grantWithin(
    transaction: DaoTransaction,
    input: GrantSubscriptionCredits,
  ) {
    const subscription = await transaction.optional<SubscriptionRow>(
      `SELECT subscription.id AS subscription_id, subscription.order_id,
              subscription.credits_allocated::text,
              subscription.start_at, subscription.expiry_at
       FROM business_subscriptions subscription
       JOIN subscription_orders purchase ON purchase.id = subscription.order_id
        AND purchase.business_id = subscription.business_id
        AND purchase.branch_id = subscription.branch_id
       JOIN branches branch ON branch.id = subscription.branch_id
        AND branch.business_id = subscription.business_id
       WHERE subscription.id = $1 AND subscription.business_id = $2
         AND subscription.branch_id = $3 AND subscription.status = 'ACTIVE'
         AND purchase.status = 'VERIFIED'
         AND subscription.credits_allocated = purchase.credits_snapshot
         AND subscription.expiry_at <= subscription.start_at +
             make_interval(days => purchase.duration_days_snapshot)
         AND subscription.expiry_at > now()
       FOR UPDATE OF subscription`,
      [input.subscriptionId, input.businessId, input.branchId],
    );
    if (!subscription) throw new CreditGrantScopeError();
    const existing = await transaction.optional<GrantReplayRow>(
      `SELECT event.id AS event_id, event.credit_event_key,
              event.credit_lot_id, event.business_id, event.branch_id,
              event.subscription_id,
              event.credit_delta::text, event.balance_before::text,
              event.balance_after::text, lot.expires_at
       FROM credit_transactions event
       JOIN credit_lots lot ON lot.id = event.credit_lot_id
       WHERE event.credit_event_key = $1 OR event.credit_lot_id = $2
       ORDER BY (event.credit_event_key = $1 AND event.credit_lot_id = $2) DESC
       LIMIT 1
       FOR UPDATE OF event, lot`,
      [input.eventKey, input.id],
    );
    if (existing) {
      if (
        existing.credit_event_key !== input.eventKey ||
        existing.credit_lot_id !== input.id ||
        existing.business_id !== input.businessId ||
        existing.branch_id !== input.branchId ||
        existing.subscription_id !== input.subscriptionId ||
        Number(existing.credit_delta) !== Number(subscription.credits_allocated)
      ) {
        throw new CreditGrantReplayConflictError();
      }
      const settled = await this.findSettledDeferred(
        transaction, subscription.order_id,
      );
      return {
        ...this.grantModel(existing, true),
        balanceAfter: settled
          ? Number(settled.balance_after) : Number(existing.balance_after),
        deferredDeductionId: settled?.deferred_id,
        settlementEventId: settled?.settlement_event_id,
        deferredSettled: Boolean(settled),
      };
    }
    await transaction.execute(
      `INSERT INTO branch_credit_wallets (branch_id, business_id)
       VALUES ($1,$2) ON CONFLICT (branch_id) DO NOTHING`,
      [input.branchId, input.businessId],
    );
    const wallet = await transaction.one<WalletRow>(
      `SELECT purchased_credits::text, available_credits::text
       FROM branch_credit_wallets
       WHERE branch_id = $1 AND business_id = $2 FOR UPDATE`,
      [input.branchId, input.businessId],
    );
    await transaction.one<{ id: string }>(
      `INSERT INTO credit_lots (
         id, business_id, branch_id, subscription_id, source_event_key,
         allocated_credits, starts_at, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        input.id, input.businessId, input.branchId, input.subscriptionId,
        input.eventKey, subscription.credits_allocated,
        subscription.start_at, subscription.expiry_at,
      ],
    );
    const next = await transaction.one<WalletRow>(
      `UPDATE branch_credit_wallets
       SET purchased_credits = purchased_credits + $3,
           available_credits = available_credits + $3,
           active_subscription_id = $4, updated_at = now()
       WHERE branch_id = $1 AND business_id = $2
       RETURNING purchased_credits::text, available_credits::text`,
      [
        input.branchId, input.businessId, subscription.credits_allocated,
        input.subscriptionId,
      ],
    );
    const event = await transaction.one<{ id: string }>(
      `INSERT INTO credit_transactions (
         business_id, branch_id, subscription_id, credit_lot_id,
         movement_type, credit_delta, balance_before, balance_after,
         related_record_type, related_record_id, credit_event_key, reason
       ) VALUES ($1,$2,$3,$4,'SUBSCRIPTION_CREDIT_GRANT',$5,$6,$7,
         'BUSINESS_SUBSCRIPTION',$3,$8,'VERIFIED_SUBSCRIPTION_GRANT')
       RETURNING id`,
      [
        input.businessId, input.branchId, input.subscriptionId, input.id,
        subscription.credits_allocated, wallet.available_credits,
        next.available_credits, input.eventKey,
      ],
    );
    await transaction.one<{ id: string }>(
      `UPDATE credit_lots SET grant_credit_transaction_id = $2,
          updated_at = now() WHERE id = $1 RETURNING id`,
      [input.id, event.id],
    );
    const settled = await this.settlePendingDeferred(transaction, {
      orderId: subscription.order_id,
      lotId: input.id,
      businessId: input.businessId,
      branchId: input.branchId,
      subscriptionId: input.subscriptionId,
      allocatedCredits: Number(subscription.credits_allocated),
    });
    return {
      eventId: event.id,
      creditLotId: input.id,
      creditsGranted: Number(subscription.credits_allocated),
      balanceBefore: Number(wallet.available_credits),
      balanceAfter: settled
        ? Number(settled.balance_after) : Number(next.available_credits),
      expiresAt: subscription.expiry_at,
      deferredDeductionId: settled?.deferred_id,
      settlementEventId: settled?.settlement_event_id,
      deferredSettled: Boolean(settled),
      replayed: false,
    };
  }

  async prepareSubscriptionVerificationWithin(
    transaction: DaoTransaction,
    input: PrepareSubscriptionVerificationCredit,
  ) {
    const existing = await transaction.optional<{
      id: string; movement_type: string; credit_delta: string;
      balance_before: string; balance_after: string;
    }>(
      `SELECT id, movement_type, credit_delta::text,
              balance_before::text, balance_after::text
       FROM credit_transactions WHERE credit_event_key = $1 FOR UPDATE`,
      [input.eventKey],
    );
    if (existing) {
      if (!['VERIFICATION_DEDUCTION','SUBSCRIPTION_VERIFICATION_DEFERRED']
        .includes(existing.movement_type)) {
        throw new CreditDeferralReplayConflictError();
      }
      return {
        decision: existing.movement_type === 'VERIFICATION_DEDUCTION'
          ? 'CHARGED' as const : 'DEFERRED' as const,
        eventId: existing.id, creditConsumed: Number(existing.credit_delta) === -1,
        balanceBefore: Number(existing.balance_before),
        balanceAfter: Number(existing.balance_after), replayed: true,
      };
    }
    await transaction.execute(
      `INSERT INTO branch_credit_wallets (branch_id, business_id)
       VALUES ($1,$2) ON CONFLICT (branch_id) DO NOTHING`,
      [input.branchId, input.businessId],
    );
    const scope = await transaction.optional<{ available_credits: string }>(
      `SELECT wallet.available_credits::text
       FROM subscription_orders purchase
       JOIN branches branch ON branch.id = purchase.branch_id
        AND branch.business_id = purchase.business_id AND branch.status = 'ACTIVE'
       JOIN branch_credit_wallets wallet ON wallet.branch_id = purchase.branch_id
        AND wallet.business_id = purchase.business_id
       WHERE purchase.id = $1 AND purchase.business_id = $2
         AND purchase.branch_id = $3
         AND purchase.status IN ('PROOF_RECEIVED','VERIFICATION_PENDING')
       FOR UPDATE OF purchase, wallet`,
      [input.subscriptionOrderId, input.businessId, input.branchId],
    );
    if (!scope) throw new CreditDeferralScopeError();
    if (scope.available_credits === '0') {
      const deferred = await this.deferSubscriptionWithin(transaction, {
        id: input.deferredId, eventKey: input.eventKey,
        businessId: input.businessId, branchId: input.branchId,
        subscriptionOrderId: input.subscriptionOrderId,
      });
      return {
        decision: 'DEFERRED' as const, eventId: deferred.eventId,
        creditConsumed: false, balanceBefore: 0, balanceAfter: 0,
        replayed: deferred.replayed,
      };
    }
    const wallet = await transaction.optional<{
      balance_before: string; balance_after: string;
      active_subscription_id: string | null; credit_lot_id: string;
    }>(
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
         ORDER BY lot.expires_at, lot.created_at, lot.id LIMIT 1
         FOR UPDATE OF wallet, lot
       ), used_lot AS (
         UPDATE credit_lots lot SET used_credits = used_credits + 1,
           status = CASE WHEN remaining_credits = 1 THEN 'EXHAUSTED' ELSE status END,
           updated_at = now() FROM selected WHERE lot.id = selected.id
         RETURNING lot.id
       )
       UPDATE branch_credit_wallets wallet
       SET used_credits = used_credits + 1,
           available_credits = available_credits - 1, updated_at = now()
       FROM selected, used_lot
       WHERE wallet.branch_id = $1 AND wallet.business_id = $2
       RETURNING (wallet.available_credits + 1)::text AS balance_before,
         wallet.available_credits::text AS balance_after,
         selected.active_subscription_id, used_lot.id AS credit_lot_id`,
      [input.branchId, input.businessId],
    );
    if (!wallet) throw new CreditDeferralBalanceError();
    const credit = await transaction.one<{ id: string }>(
      `INSERT INTO credit_transactions (
         business_id, branch_id, subscription_id, credit_lot_id, movement_type,
         credit_delta, balance_before, balance_after, related_record_type,
         related_record_id, credit_event_key, reason
       ) VALUES ($1,$2,$3,$4,'VERIFICATION_DEDUCTION',-1,$5,$6,
         'SUBSCRIPTION_ORDER',$7,$8,'SUBSCRIPTION_PAYMENT_VERIFICATION')
       RETURNING id`,
      [input.businessId, input.branchId, wallet.active_subscription_id,
       wallet.credit_lot_id, wallet.balance_before, wallet.balance_after,
       input.subscriptionOrderId, input.eventKey],
    );
    await transaction.execute(
      `INSERT INTO credit_usage_alerts (
         business_id, branch_id, credit_lot_id, threshold_percent,
         used_credits, expired_credits, allocated_credits, trigger_event_id
       ) SELECT lot.business_id, lot.branch_id, lot.id, threshold,
                lot.used_credits, lot.expired_credits, lot.allocated_credits, $2
         FROM credit_lots lot
         CROSS JOIN unnest(ARRAY[75,90,100]::smallint[]) threshold
         WHERE lot.id = $1 AND ((lot.used_credits + lot.expired_credits) * 100) >=
           (lot.allocated_credits * threshold)
       ON CONFLICT (credit_lot_id, threshold_percent) DO NOTHING`,
      [wallet.credit_lot_id, credit.id],
    );
    await transaction.execute(
      `UPDATE subscription_orders SET status = 'VERIFICATION_PENDING' WHERE id = $1`,
      [input.subscriptionOrderId],
    );
    return {
      decision: 'CHARGED' as const, eventId: credit.id, creditConsumed: true,
      balanceBefore: Number(wallet.balance_before),
      balanceAfter: Number(wallet.balance_after), replayed: false,
    };
  }

  async expireDueWithin(
    transaction: DaoTransaction,
    effectiveAt: Date,
    limit: number,
  ) {
    const lots = await transaction.many<DueLotRow>(
      `SELECT id, business_id, branch_id, remaining_credits::text,
              used_credits::text, allocated_credits::text
       FROM credit_lots
       WHERE status = 'ACTIVE' AND remaining_credits > 0
         AND expires_at <= $1
       ORDER BY expires_at, created_at, id
       LIMIT $2 FOR UPDATE SKIP LOCKED`,
      [effectiveAt, limit],
    );
    const expired = [];
    for (const lot of lots) {
      const wallet = await transaction.one<{
        balance_before: string;
        balance_after: string;
      }>(
        `UPDATE branch_credit_wallets
         SET expired_credits = expired_credits + $3,
             available_credits = available_credits - $3,
             updated_at = now()
         WHERE branch_id = $1 AND business_id = $2
           AND available_credits >= $3
         RETURNING (available_credits + $3)::text AS balance_before,
                   available_credits::text AS balance_after`,
        [lot.branch_id, lot.business_id, lot.remaining_credits],
      );
      await transaction.one<{ id: string }>(
        `UPDATE credit_lots
         SET expired_credits = expired_credits + remaining_credits,
             status = 'EXPIRED', updated_at = now()
         WHERE id = $1 RETURNING id`,
        [lot.id],
      );
      const event = await transaction.one<{ id: string }>(
        `INSERT INTO credit_transactions (
           business_id, branch_id, credit_lot_id, movement_type,
           credit_delta, balance_before, balance_after,
           related_record_type, related_record_id, credit_event_key, reason
         ) VALUES ($1,$2,$3,'CREDIT_EXPIRY',$4,$5,$6,
           'CREDIT_LOT',$3,$7,'CREDIT_LOT_EXPIRED') RETURNING id`,
        [
          lot.business_id, lot.branch_id, lot.id,
          -Number(lot.remaining_credits), wallet.balance_before,
          wallet.balance_after, `expiry:lot:${lot.id}`,
        ],
      );
      await this.recordThresholds(transaction, {
        lotId: lot.id, businessId: lot.business_id, branchId: lot.branch_id,
        usedCredits: Number(lot.used_credits),
        expiredCredits: Number(lot.remaining_credits),
        allocatedCredits: Number(lot.allocated_credits), eventId: event.id,
      });
      expired.push({
        creditLotId: lot.id,
        creditsExpired: Number(lot.remaining_credits),
        balanceBefore: Number(wallet.balance_before),
        balanceAfter: Number(wallet.balance_after),
        eventId: event.id,
      });
    }
    return expired;
  }

  private async settlePendingDeferred(
    transaction: DaoTransaction,
    input: {
      orderId: string;
      lotId: string;
      businessId: string;
      branchId: string;
      subscriptionId: string;
      allocatedCredits: number;
    },
  ): Promise<SettledDeferredRow | undefined> {
    const deferred = await transaction.optional<{ id: string }>(
      `SELECT id FROM deferred_credit_deductions
       WHERE subscription_order_id = $1 AND business_id = $2
         AND branch_id = $3 AND status = 'PENDING'
       FOR UPDATE`,
      [input.orderId, input.businessId, input.branchId],
    );
    if (!deferred) return undefined;
    await transaction.one<{ id: string }>(
      `UPDATE credit_lots
       SET used_credits = used_credits + 1,
           status = CASE WHEN remaining_credits = 1
                         THEN 'EXHAUSTED' ELSE status END,
           updated_at = now()
       WHERE id = $1 AND remaining_credits > 0 RETURNING id`,
      [input.lotId],
    );
    const wallet = await transaction.one<{
      balance_before: string;
      balance_after: string;
    }>(
      `UPDATE branch_credit_wallets
       SET used_credits = used_credits + 1,
           available_credits = available_credits - 1,
           updated_at = now()
       WHERE branch_id = $1 AND business_id = $2 AND available_credits > 0
       RETURNING (available_credits + 1)::text AS balance_before,
                 available_credits::text AS balance_after`,
      [input.branchId, input.businessId],
    );
    const event = await transaction.one<{ id: string }>(
      `INSERT INTO credit_transactions (
         business_id, branch_id, subscription_id, credit_lot_id,
         movement_type, credit_delta, balance_before, balance_after,
         related_record_type, related_record_id, credit_event_key, reason
       ) VALUES ($1,$2,$3,$4,'DEFERRED_DEDUCTION_SETTLED',-1,$5,$6,
         'DEFERRED_CREDIT_DEDUCTION',$7,$8,'DEFERRED_SUBSCRIPTION_CHARGE_SETTLED')
       RETURNING id`,
      [
        input.businessId, input.branchId, input.subscriptionId, input.lotId,
        wallet.balance_before, wallet.balance_after, deferred.id,
        `deferred-settlement:${deferred.id}`,
      ],
    );
    await transaction.one<{ id: string }>(
      `UPDATE deferred_credit_deductions
       SET status = 'SETTLED', settled_event_id = $2, settled_at = now()
       WHERE id = $1 RETURNING id`,
      [deferred.id, event.id],
    );
    await this.recordThresholds(transaction, {
      lotId: input.lotId, businessId: input.businessId,
      branchId: input.branchId, usedCredits: 1, expiredCredits: 0,
      allocatedCredits: input.allocatedCredits, eventId: event.id,
    });
    return {
      deferred_id: deferred.id,
      settlement_event_id: event.id,
      balance_after: wallet.balance_after,
    };
  }

  private findSettledDeferred(
    transaction: DaoTransaction,
    orderId: string,
  ) {
    return transaction.optional<SettledDeferredRow>(
      `SELECT deferred.id AS deferred_id,
              event.id AS settlement_event_id, event.balance_after::text
       FROM deferred_credit_deductions deferred
       JOIN credit_transactions event ON event.id = deferred.settled_event_id
       WHERE deferred.subscription_order_id = $1 AND deferred.status = 'SETTLED'`,
      [orderId],
    );
  }

  recordThresholds(
    transaction: DaoTransaction,
    input: {
      lotId: string;
      businessId: string;
      branchId: string;
      usedCredits: number;
      expiredCredits: number;
      allocatedCredits: number;
      eventId: string;
    },
  ) {
    return transaction.execute(
      `INSERT INTO credit_usage_alerts (
         business_id, branch_id, credit_lot_id, threshold_percent,
         used_credits, expired_credits, allocated_credits, trigger_event_id
       ) SELECT $1,$2,$3,threshold,$4::bigint,$5::bigint,$6::bigint,$7
         FROM unnest(ARRAY[75,90,100]::smallint[]) threshold
         WHERE (($4::bigint + $5::bigint) * 100) >=
               ($6::bigint * threshold)
       ON CONFLICT (credit_lot_id, threshold_percent) DO NOTHING`,
      [
        input.businessId, input.branchId, input.lotId, input.usedCredits,
        input.expiredCredits, input.allocatedCredits, input.eventId,
      ],
    ).then(async (inserted) => {
      await this.notifications.notifyCreditThresholdsWithin(
        transaction, input.eventId,
      );
      return inserted;
    });
  }

  private grantModel(row: GrantReplayRow, replayed: boolean) {
    return {
      eventId: row.event_id,
      creditLotId: row.credit_lot_id,
      creditsGranted: Number(row.credit_delta),
      balanceBefore: Number(row.balance_before),
      balanceAfter: Number(row.balance_after),
      expiresAt: row.expires_at,
      replayed,
    };
  }
}
