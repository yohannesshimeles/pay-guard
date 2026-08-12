import { Injectable } from '@nestjs/common';
import { CentralDao } from '../database/central.dao';

export type NotificationDeliveryClaim = {
  notificationId: string; deviceId: string; attemptNo: number;
  claimToken: string; title: string; message: string;
  tokenCiphertext: string; tokenIv: string; tokenAuthTag: string;
};

@Injectable()
export class NotificationDeliveryDao {
  constructor(private readonly dao: CentralDao) {}

  claimNext(): Promise<NotificationDeliveryClaim | undefined> {
    return this.dao.transaction(async (transaction) => {
      const candidate = await transaction.optional<{
        id: string; device_id: string; title: string; message: string;
        push_attempt_count: number; token_ciphertext: string; token_iv: string;
        token_auth_tag: string;
      }>(
        `SELECT n.id, d.id AS device_id, n.title, n.message,
           n.push_attempt_count, d.token_ciphertext, d.token_iv, d.token_auth_tag
         FROM notifications n
         JOIN notification_devices d ON d.is_active AND (
           d.user_id = n.recipient_user_id OR
           d.platform_admin_id = n.recipient_platform_admin_id)
         LEFT JOIN notification_preferences preference ON
           preference.notification_type = n.notification_type AND (
             preference.user_id = n.recipient_user_id OR
             preference.platform_admin_id = n.recipient_platform_admin_id)
         WHERE n.push_attempt_count < 3
           AND (n.push_status = 'PENDING' OR
             (n.push_status = 'SENDING' AND n.push_claimed_at < now() - interval '2 minutes'))
           AND COALESCE(preference.push_enabled, true)
           AND n.visible_until > now()
           AND NOT EXISTS (
             SELECT 1 FROM notification_delivery_attempts attempt
             WHERE attempt.notification_id = n.id AND attempt.retry_at > now())
         ORDER BY n.created_at, n.id
         FOR UPDATE OF n SKIP LOCKED LIMIT 1`,
      );
      if (!candidate) return undefined;
      const claimed = await transaction.one<{
        push_claim_token: string; push_attempt_count: number;
      }>(
        `UPDATE notifications SET push_status = 'SENDING',
           push_claim_token = gen_random_uuid(), push_claimed_at = now(),
           push_attempt_count = push_attempt_count + 1
         WHERE id = $1 RETURNING push_claim_token, push_attempt_count`,
        [candidate.id],
      );
      return {
        notificationId: candidate.id, deviceId: candidate.device_id,
        attemptNo: claimed.push_attempt_count,
        claimToken: claimed.push_claim_token, title: candidate.title,
        message: candidate.message, tokenCiphertext: candidate.token_ciphertext,
        tokenIv: candidate.token_iv, tokenAuthTag: candidate.token_auth_tag,
      };
    });
  }

  complete(claim: NotificationDeliveryClaim, providerMessageId: string) {
    return this.dao.transaction(async (transaction) => {
      await transaction.one<{ id: string }>(
        `INSERT INTO notification_delivery_attempts (
           notification_id, notification_device_id, attempt_no, status,
           provider, provider_message_id
         ) VALUES ($1,$2,$3,'DELIVERED','FIREBASE',$4) RETURNING id`,
        [claim.notificationId, claim.deviceId, claim.attemptNo, providerMessageId],
      );
      await transaction.execute(
        `UPDATE notifications SET push_status = 'DELIVERED', sent_at = now(),
           push_claim_token = NULL, push_claimed_at = NULL,
           push_last_error_code = NULL
         WHERE id = $1 AND push_claim_token = $2`,
        [claim.notificationId, claim.claimToken],
      );
    });
  }

  fail(claim: NotificationDeliveryClaim, code: string, retryable: boolean,
    retryAt?: Date) {
    const final = !retryable || claim.attemptNo >= 3;
    return this.dao.transaction(async (transaction) => {
      await transaction.one<{ id: string }>(
        `INSERT INTO notification_delivery_attempts (
           notification_id, notification_device_id, attempt_no, status,
           provider, failure_code, failure_reason, retry_at
         ) VALUES ($1,$2,$3,'FAILED','FIREBASE',$4,$4,$5) RETURNING id`,
        [claim.notificationId, claim.deviceId, claim.attemptNo, code,
         final ? null : retryAt ?? null],
      );
      await transaction.execute(
        `UPDATE notifications SET push_status = $3,
           push_claim_token = NULL, push_claimed_at = NULL,
           push_last_error_code = $4
         WHERE id = $1 AND push_claim_token = $2`,
        [claim.notificationId, claim.claimToken, final ? 'FAILED' : 'PENDING', code],
      );
    });
  }
}
