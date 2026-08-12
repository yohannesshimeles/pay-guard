import { Injectable } from '@nestjs/common';
import { DaoTransaction } from '../database/central.dao';

type RecoveryRow = {
  id: string; request_key: string; business_id: string; purchase_lock_id: string;
  delivered_to_user_id: string; generated_by_admin_id: string;
  review_note: string; status: 'ACTIVE' | 'USED' | 'REVOKED';
  generated_at: Date; expires_at: Date; used_at: Date | null;
  revoked_at: Date | null;
};

export class FraudReviewRecoveryScopeError extends Error {}
export class RecoveryAuthorizationConflictError extends Error {}
export class RecoveryAuthorizationInvalidError extends Error {}

@Injectable()
export class RecoveryAuthorizationDao {
  async issueWithin(transaction: DaoTransaction, input: {
    id: string; requestKey: string; fraudReviewId: string; codeHash: string;
    deliveredToUserId: string; reviewNote: string; expiresInMinutes: number;
    platformAdminId: string;
  }) {
    const existing = await transaction.optional<RecoveryRow>(
      `SELECT * FROM recovery_codes WHERE request_key = $1 FOR UPDATE`,
      [input.requestKey],
    );
    if (existing) throw new RecoveryAuthorizationConflictError();
    const context = await transaction.optional<{
      business_id: string; lock_id: string; alert_id: string;
    }>(
      `SELECT flag.business_id, purchase_lock.id AS lock_id,
              attempt.fraud_alert_id AS alert_id
       FROM fraud_flags flag
       JOIN subscription_fraud_attempts attempt ON attempt.fraud_flag_id = flag.id
       JOIN subscription_purchase_locks purchase_lock
         ON purchase_lock.business_id = flag.business_id
        AND purchase_lock.status = 'ACTIVE'
       JOIN business_user_memberships membership
         ON membership.business_id = flag.business_id
        AND membership.user_id = $2 AND membership.status = 'ACTIVE'
       JOIN membership_role_assignments role_assignment
         ON role_assignment.membership_id = membership.id
        AND role_assignment.role_code IN ('PRIMARY_OWNER','ADDITIONAL_OWNER')
        AND role_assignment.status = 'ACTIVE'
       JOIN users recipient ON recipient.id = membership.user_id
        AND recipient.global_status = 'ACTIVE'
       WHERE flag.id = $1 AND flag.event_type = 'CROSS_DAY_DUPLICATE'
         AND flag.status = 'OPEN'
       FOR UPDATE OF flag, purchase_lock`,
      [input.fraudReviewId, input.deliveredToUserId],
    );
    if (!context) throw new FraudReviewRecoveryScopeError();
    const active = await transaction.optional<{ id: string }>(
      `SELECT id FROM recovery_codes
       WHERE purchase_lock_id = $1 AND status = 'ACTIVE' AND expires_at > now()
       FOR UPDATE`,
      [context.lock_id],
    );
    if (active) throw new RecoveryAuthorizationConflictError();
    await transaction.execute(
      `UPDATE recovery_codes SET status = 'REVOKED', revoked_at = now(),
         revoked_by_admin_id = $2,
         revocation_reason = 'Expired before replacement'
       WHERE purchase_lock_id = $1 AND status = 'ACTIVE' AND expires_at <= now()`,
      [context.lock_id, input.platformAdminId],
    );
    const recovery = await transaction.one<RecoveryRow>(
      `INSERT INTO recovery_codes (
         id, request_key, business_id, purchase_lock_id, code_hash,
         generated_by_admin_id, review_note, delivered_to_user_id,
         delivery_status, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'SENT',
         now() + make_interval(mins => $9::int)) RETURNING *`,
      [input.id, input.requestKey, context.business_id, context.lock_id,
       input.codeHash, input.platformAdminId, input.reviewNote.trim(),
       input.deliveredToUserId, input.expiresInMinutes],
    );
    await transaction.execute(
      `UPDATE subscription_purchase_locks SET status = 'RECOVERY_ISSUED'
       WHERE id = $1`, [context.lock_id],
    );
    await transaction.execute(
      `UPDATE fraud_flags SET review_note = $2 WHERE id = $1`,
      [input.fraudReviewId, input.reviewNote.trim()],
    );
    await transaction.execute(
      `UPDATE security_alerts SET acknowledged_at = now(),
         acknowledged_by_platform_admin_id = $2,
         acknowledgement_note = $3
       WHERE business_id = $1 AND alert_type = 'SUBSCRIPTION_CROSS_DAY_REUSE'
         AND acknowledged_at IS NULL`,
      [context.business_id, input.platformAdminId, input.reviewNote.trim()],
    );
    return this.publicModel(recovery);
  }

  async revokeWithin(transaction: DaoTransaction, input: {
    fraudReviewId: string; recoveryCodeId: string; platformAdminId: string;
    reason: string;
  }) {
    const recovery = await transaction.optional<RecoveryRow>(
      `SELECT recovery.* FROM recovery_codes recovery
       JOIN fraud_flags flag ON flag.business_id = recovery.business_id
       JOIN subscription_fraud_attempts attempt ON attempt.fraud_flag_id = flag.id
       WHERE flag.id = $1 AND recovery.id = $2
         AND flag.event_type = 'CROSS_DAY_DUPLICATE'
       FOR UPDATE OF recovery`,
      [input.fraudReviewId, input.recoveryCodeId],
    );
    if (!recovery) throw new FraudReviewRecoveryScopeError();
    if (recovery.status !== 'ACTIVE') throw new RecoveryAuthorizationConflictError();
    const updated = await transaction.one<RecoveryRow>(
      `UPDATE recovery_codes SET status = 'REVOKED', revoked_at = now(),
         revoked_by_admin_id = $2, revocation_reason = $3
       WHERE id = $1 RETURNING *`,
      [recovery.id, input.platformAdminId, input.reason.trim()],
    );
    await transaction.execute(
      `UPDATE subscription_purchase_locks SET status = 'ACTIVE'
       WHERE id = $1 AND status = 'RECOVERY_ISSUED'`,
      [recovery.purchase_lock_id],
    );
    return this.publicModel(updated);
  }

  async redeemWithin(transaction: DaoTransaction, input: {
    businessId: string; userId: string; codeHash: string;
  }) {
    const recovery = await transaction.optional<RecoveryRow>(
      `SELECT recovery.* FROM recovery_codes recovery
       JOIN subscription_purchase_locks purchase_lock
         ON purchase_lock.id = recovery.purchase_lock_id
       JOIN business_user_memberships membership
         ON membership.business_id = recovery.business_id
        AND membership.user_id = $2 AND membership.status = 'ACTIVE'
       JOIN membership_role_assignments role_assignment
         ON role_assignment.membership_id = membership.id
        AND role_assignment.role_code IN ('PRIMARY_OWNER','ADDITIONAL_OWNER')
        AND role_assignment.status = 'ACTIVE'
       WHERE recovery.business_id = $1 AND recovery.code_hash = $3
         AND recovery.delivered_to_user_id = $2
         AND recovery.status = 'ACTIVE' AND recovery.expires_at > now()
         AND purchase_lock.status = 'RECOVERY_ISSUED'
       FOR UPDATE OF recovery, purchase_lock`,
      [input.businessId, input.userId, input.codeHash],
    );
    if (!recovery) throw new RecoveryAuthorizationInvalidError();
    const used = await transaction.one<RecoveryRow>(
      `UPDATE recovery_codes SET status = 'USED', used_by_user_id = $2,
         used_at = now() WHERE id = $1 RETURNING *`,
      [recovery.id, input.userId],
    );
    await transaction.execute(
      `UPDATE subscription_purchase_locks SET status = 'UNLOCKED',
         unlocked_at = now() WHERE id = $1`, [recovery.purchase_lock_id],
    );
    await transaction.execute(
      `UPDATE fraud_flags SET status = 'CLEARED',
         cleared_by_admin_id = $2, cleared_at = now(),
         review_note = COALESCE(review_note, $3)
       WHERE business_id = $1 AND status = 'OPEN'
         AND event_type IN ('CROSS_DAY_DUPLICATE','THREE_DUPLICATES')`,
      [input.businessId, recovery.generated_by_admin_id, recovery.review_note],
    );
    return this.publicModel(used);
  }

  private publicModel(row: RecoveryRow) {
    return {
      id: row.id, requestKey: row.request_key, businessId: row.business_id,
      purchaseLockId: row.purchase_lock_id,
      deliveredToUserId: row.delivered_to_user_id,
      generatedByAdminId: row.generated_by_admin_id,
      status: row.status, generatedAt: row.generated_at,
      expiresAt: row.expires_at,
      ...(row.used_at ? { usedAt: row.used_at } : {}),
      ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
    };
  }
}

