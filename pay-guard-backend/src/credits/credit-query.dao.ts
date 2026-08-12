import { Injectable } from '@nestjs/common';
import { CentralDao } from '../database/central.dao';
import { CreditEventEntity } from './credit-event.entity';
import { CreditEventType } from './credit-event-type.enum';
import { CreditLotEntity, CreditLotStatus } from './credit-lot.entity';
import { CreditWalletEntity } from './credit-wallet.entity';

type WalletRow = {
  business_id: string;
  branch_id: string;
  purchased_credits: string;
  used_credits: string;
  expired_credits: string;
  available_credits: string;
  active_subscription_id: string | null;
  updated_at: Date;
};
type LotRow = {
  id: string;
  subscription_id: string | null;
  allocated_credits: string;
  used_credits: string;
  expired_credits: string;
  remaining_credits: string;
  starts_at: Date;
  expires_at: Date;
  status: CreditLotStatus;
  created_at: Date;
};
type EventRow = {
  id: string;
  movement_type: CreditEventType;
  credit_delta: string;
  balance_before: string;
  balance_after: string;
  related_record_type: string | null;
  related_record_id: string | null;
  reason: string | null;
  created_at: Date;
};
type AlertRow = {
  id: string;
  credit_lot_id: string;
  threshold_percent: number;
  used_credits: string;
  expired_credits: string;
  allocated_credits: string;
  created_at: Date;
};

@Injectable()
export class CreditQueryDao {
  constructor(private readonly dao: CentralDao) {}

  async findWallet(businessId: string, branchId: string) {
    const row = await this.dao.optional<WalletRow>(
      `SELECT wallet.business_id, wallet.branch_id,
              wallet.purchased_credits::text, wallet.used_credits::text,
              wallet.expired_credits::text, wallet.available_credits::text,
              wallet.active_subscription_id, wallet.updated_at
       FROM branch_credit_wallets wallet
       JOIN branches branch ON branch.id = wallet.branch_id
        AND branch.business_id = wallet.business_id
       WHERE wallet.business_id = $1 AND wallet.branch_id = $2`,
      [businessId, branchId],
    );
    return row ? new CreditWalletEntity({
      businessId: row.business_id,
      branchId: row.branch_id,
      purchasedCredits: Number(row.purchased_credits),
      usedCredits: Number(row.used_credits),
      expiredCredits: Number(row.expired_credits),
      availableCredits: Number(row.available_credits),
      activeSubscriptionId: row.active_subscription_id ?? undefined,
      updatedAt: row.updated_at,
    }) : undefined;
  }

  async listLots(businessId: string, branchId: string) {
    const rows = await this.dao.many<LotRow>(
      `SELECT id, subscription_id, allocated_credits::text,
              used_credits::text, expired_credits::text,
              remaining_credits::text, starts_at, expires_at, status, created_at
       FROM credit_lots
       WHERE business_id = $1 AND branch_id = $2
       ORDER BY expires_at, created_at, id`,
      [businessId, branchId],
    );
    return rows.map((row) => new CreditLotEntity({
      id: row.id,
      subscriptionId: row.subscription_id ?? undefined,
      allocatedCredits: Number(row.allocated_credits),
      usedCredits: Number(row.used_credits),
      expiredCredits: Number(row.expired_credits),
      remainingCredits: Number(row.remaining_credits),
      startsAt: row.starts_at,
      expiresAt: row.expires_at,
      status: row.status,
      createdAt: row.created_at,
    }));
  }

  async listHistory(
    businessId: string,
    branchId: string,
    input: { eventType?: CreditEventType; limit: number; offset: number },
  ) {
    const rows = await this.dao.many<EventRow>(
      `SELECT event.id, event.movement_type, event.credit_delta::text,
              event.balance_before::text, event.balance_after::text,
              event.related_record_type, event.related_record_id,
              event.reason, event.created_at
       FROM credit_transactions event
       JOIN branches branch ON branch.id = event.branch_id
        AND branch.business_id = event.business_id
       WHERE event.business_id = $1 AND event.branch_id = $2
         AND ($3::text IS NULL OR event.movement_type = $3)
       ORDER BY event.created_at DESC, event.id DESC
       LIMIT $4 OFFSET $5`,
      [businessId, branchId, input.eventType ?? null, input.limit, input.offset],
    );
    return rows.map((row) => new CreditEventEntity({
      id: row.id,
      eventType: row.movement_type,
      creditDelta: Number(row.credit_delta),
      balanceBefore: Number(row.balance_before),
      balanceAfter: Number(row.balance_after),
      relatedRecordType: row.related_record_type ?? undefined,
      relatedRecordId: row.related_record_id ?? undefined,
      reason: row.reason ?? undefined,
      createdAt: row.created_at,
    }));
  }

  listAlerts(businessId: string, branchId: string) {
    return this.dao.many<AlertRow>(
      `SELECT id, credit_lot_id, threshold_percent, used_credits::text,
              expired_credits::text, allocated_credits::text, created_at
       FROM credit_usage_alerts
       WHERE business_id = $1 AND branch_id = $2
       ORDER BY created_at DESC, threshold_percent DESC, id DESC
       LIMIT 100`,
      [businessId, branchId],
    ).then((rows) => rows.map((row) => ({
      id: row.id,
      creditLotId: row.credit_lot_id,
      thresholdPercent: row.threshold_percent,
      usedCredits: Number(row.used_credits),
      expiredCredits: Number(row.expired_credits),
      allocatedCredits: Number(row.allocated_credits),
      createdAt: row.created_at,
    })));
  }
}
