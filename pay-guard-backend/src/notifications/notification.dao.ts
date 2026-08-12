import { Injectable } from '@nestjs/common';
import { CentralDao, DaoTransaction } from '../database/central.dao';
import {
  NotificationPreferenceView, NotificationRecipient, NotificationTemplateKey,
  NotificationType, NotificationView,
} from './notification.models';
import { V2AuditService } from '../audit/v2-audit.service';
import { V2SelectedAuthContext } from '../auth/v2-auth.types';

type NotificationRow = {
  id: string; title: string; message: string; notification_type: string;
  is_read: boolean; read_at: Date | null; created_at: Date;
};

@Injectable()
export class NotificationDao {
  constructor(
    private readonly dao: CentralDao,
    private readonly audit: V2AuditService,
  ) {}

  async createWithin(transaction: DaoTransaction, input: {
    recipient: NotificationRecipient;
    templateKey: NotificationTemplateKey;
    notificationType: NotificationType;
    title: string;
    message: string;
    idempotencyKey: string;
    businessId?: string;
    branchId?: string;
    variables: Record<string, string | number>;
  }): Promise<{ id: string }> {
    return transaction.one<{ id: string }>(
      `INSERT INTO notifications (
         recipient_user_id, recipient_platform_admin_id, business_id, branch_id,
         title, message, notification_type, template_key, idempotency_key,
         variables_json
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
       DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
       RETURNING id`,
      [
        input.recipient.identityType === 'BUSINESS_USER'
          ? input.recipient.id : null,
        input.recipient.identityType === 'PLATFORM_ADMIN'
          ? input.recipient.id : null,
        input.businessId ?? null, input.branchId ?? null,
        input.title, input.message, input.notificationType, input.templateKey,
        input.idempotencyKey, JSON.stringify(input.variables),
      ],
    );
  }

  async createPlatformAdminFraudBroadcastWithin(
    transaction: DaoTransaction,
    input: {
      verificationId: string;
      businessId: string;
      branchId: string;
      attemptNumber: number;
    },
  ): Promise<number> {
    return transaction.execute(
      `INSERT INTO notifications (
         recipient_platform_admin_id, business_id, branch_id, title, message,
         notification_type, template_key, idempotency_key, variables_json
       )
       SELECT admin.id, $2::uuid, $3::uuid, 'Subscription fraud alert',
         'Cross-day payment proof reuse was detected for business ' ||
           $2::uuid::text || ' (attempt ' || $4::integer::text || ').',
         'FRAUD_ALERT', 'SUBSCRIPTION_FRAUD_ALERT',
         'subscription-fraud:' || $1::uuid::text ||
           ':platform-admin:' || admin.id::text,
         jsonb_build_object(
           'businessId', $2::uuid::text,
           'attemptNumber', $4::integer
         )
       FROM platform_admin admin
       LEFT JOIN notification_preferences preference
         ON preference.platform_admin_id = admin.id
        AND preference.notification_type = 'FRAUD_ALERT'
       WHERE admin.status = 'ACTIVE'
         AND COALESCE(preference.in_app_enabled, true)
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
       DO NOTHING`,
      [input.verificationId, input.businessId, input.branchId,
       input.attemptNumber],
    );
  }

  async list(recipient: NotificationRecipient, limit: number, offset: number) {
    const rows = await this.dao.many<NotificationRow>(
      `SELECT id, title, message, notification_type, is_read, read_at, created_at
       FROM notifications
       WHERE (($1::uuid IS NOT NULL AND recipient_user_id = $1)
          OR ($2::uuid IS NOT NULL AND recipient_platform_admin_id = $2))
         AND deleted_from_view_at IS NULL AND visible_until > now()
       ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4`,
      [recipient.identityType === 'BUSINESS_USER' ? recipient.id : null,
       recipient.identityType === 'PLATFORM_ADMIN' ? recipient.id : null,
       limit, offset],
    );
    return rows.map(mapNotification);
  }

  async markRead(recipient: NotificationRecipient, notificationId: string) {
    const row = await this.dao.optional<NotificationRow>(
      `UPDATE notifications SET is_read = true, read_at = COALESCE(read_at, now())
       WHERE id = $1
         AND (($2::uuid IS NOT NULL AND recipient_user_id = $2)
          OR ($3::uuid IS NOT NULL AND recipient_platform_admin_id = $3))
         AND deleted_from_view_at IS NULL
       RETURNING id, title, message, notification_type, is_read, read_at, created_at`,
      [notificationId,
       recipient.identityType === 'BUSINESS_USER' ? recipient.id : null,
       recipient.identityType === 'PLATFORM_ADMIN' ? recipient.id : null],
    );
    return row ? mapNotification(row) : undefined;
  }

  async preferences(recipient: NotificationRecipient) {
    const rows = await this.dao.many<{
      notification_type: string; in_app_enabled: boolean; push_enabled: boolean;
    }>(
      `SELECT notification_type, in_app_enabled, push_enabled
       FROM notification_preferences
       WHERE (($1::uuid IS NOT NULL AND user_id = $1)
          OR ($2::uuid IS NOT NULL AND platform_admin_id = $2))
       ORDER BY notification_type`,
      [recipient.identityType === 'BUSINESS_USER' ? recipient.id : null,
       recipient.identityType === 'PLATFORM_ADMIN' ? recipient.id : null],
    );
    return rows.map((row): NotificationPreferenceView => ({
      notificationType: row.notification_type,
      inAppEnabled: row.in_app_enabled,
      pushEnabled: row.push_enabled,
    }));
  }

  async upsertPreference(recipient: NotificationRecipient, input: {
    notificationType: NotificationType; inAppEnabled: boolean; pushEnabled: boolean;
  }, auditInput: { actor: V2SelectedAuthContext; sessionId: string }) {
    const userId = recipient.identityType === 'BUSINESS_USER' ? recipient.id : null;
    const platformAdminId = recipient.identityType === 'PLATFORM_ADMIN'
      ? recipient.id : null;
    const conflict = userId
      ? '(user_id, notification_type) WHERE user_id IS NOT NULL'
      : '(platform_admin_id, notification_type) WHERE platform_admin_id IS NOT NULL';
    return this.dao.transaction(async (transaction) => {
      const previous = await transaction.optional<{
        in_app_enabled: boolean; push_enabled: boolean;
      }>(
        `SELECT in_app_enabled, push_enabled FROM notification_preferences
         WHERE notification_type = $3
           AND (($1::uuid IS NOT NULL AND user_id = $1)
             OR ($2::uuid IS NOT NULL AND platform_admin_id = $2))`,
        [userId, platformAdminId, input.notificationType],
      );
      const row = await transaction.one<{
        id: string; notification_type: string;
        in_app_enabled: boolean; push_enabled: boolean;
      }>(
        `INSERT INTO notification_preferences (
         user_id, platform_admin_id, notification_type, in_app_enabled, push_enabled
       ) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT ${conflict} DO UPDATE SET
         in_app_enabled = EXCLUDED.in_app_enabled,
         push_enabled = EXCLUDED.push_enabled, updated_at = now()
       RETURNING id, notification_type, in_app_enabled, push_enabled`,
        [userId, platformAdminId, input.notificationType,
         input.inAppEnabled, input.pushEnabled],
      );
      await this.audit.recordWithin(transaction, {
        actor: auditInput.actor,
        sessionId: auditInput.sessionId,
        actionType: 'NOTIFICATION_PREFERENCE_UPDATED',
        recordType: 'NOTIFICATION_PREFERENCE',
        recordId: row.id,
        previousValue: previous ? {
          inAppEnabled: previous.in_app_enabled,
          pushEnabled: previous.push_enabled,
        } : undefined,
        newValue: {
          notificationType: row.notification_type,
          inAppEnabled: row.in_app_enabled,
          pushEnabled: row.push_enabled,
        },
      });
      return {
        notificationType: row.notification_type,
        inAppEnabled: row.in_app_enabled,
        pushEnabled: row.push_enabled,
      } satisfies NotificationPreferenceView;
    });
  }
}

function mapNotification(row: NotificationRow): NotificationView {
  return {
    id: row.id, title: row.title, message: row.message,
    notificationType: row.notification_type, isRead: row.is_read,
    readAt: row.read_at, createdAt: row.created_at,
  };
}
