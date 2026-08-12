import { Injectable } from '@nestjs/common';
import { CentralDao } from '../database/central.dao';
import { NotificationRecipient } from './notification.models';
import { EncryptedNotificationToken } from './notification-token-crypto.service';

@Injectable()
export class NotificationDeviceDao {
  constructor(private readonly dao: CentralDao) {}

  register(recipient: NotificationRecipient, platform: 'android' | 'ios' | 'web',
    token: EncryptedNotificationToken) {
    return this.dao.transaction(async (transaction) => {
      const userId = recipient.identityType === 'BUSINESS_USER' ? recipient.id : null;
      const adminId = recipient.identityType === 'PLATFORM_ADMIN' ? recipient.id : null;
      await transaction.execute(
        `UPDATE notification_devices SET is_active = false, deactivated_at = now()
         WHERE is_active AND (($1::uuid IS NOT NULL AND user_id = $1)
           OR ($2::uuid IS NOT NULL AND platform_admin_id = $2))`,
        [userId, adminId],
      );
      const registered = await transaction.optional<{
        id: string; platform: string; last_registered_at: Date;
      }>(
        `INSERT INTO notification_devices (
           user_id, platform_admin_id, platform, token_ciphertext, token_iv,
           token_auth_tag, token_fingerprint
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (token_fingerprint) DO UPDATE SET
           platform = EXCLUDED.platform, token_ciphertext = EXCLUDED.token_ciphertext,
           token_iv = EXCLUDED.token_iv, token_auth_tag = EXCLUDED.token_auth_tag,
           is_active = true, deactivated_at = NULL, last_registered_at = now()
         WHERE notification_devices.user_id IS NOT DISTINCT FROM EXCLUDED.user_id
           AND notification_devices.platform_admin_id IS NOT DISTINCT FROM
             EXCLUDED.platform_admin_id
         RETURNING id, platform, last_registered_at`,
        [userId, adminId, platform, token.ciphertext, token.iv, token.authTag,
         token.fingerprint],
      );
      if (!registered) throw new NotificationDeviceOwnershipConflictError();
      return registered;
    });
  }

  deactivate(recipient: NotificationRecipient, id: string) {
    return this.dao.execute(
      `UPDATE notification_devices SET is_active = false, deactivated_at = now()
       WHERE id = $1 AND is_active
         AND (($2::uuid IS NOT NULL AND user_id = $2)
          OR ($3::uuid IS NOT NULL AND platform_admin_id = $3))`,
      [id, recipient.identityType === 'BUSINESS_USER' ? recipient.id : null,
       recipient.identityType === 'PLATFORM_ADMIN' ? recipient.id : null],
    );
  }
}

export class NotificationDeviceOwnershipConflictError extends Error {}
