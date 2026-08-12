import { Injectable } from '@nestjs/common';
import { DaoTransaction } from '../database/central.dao';
import { NotificationDao } from '../notifications/notification.dao';

@Injectable()
export class FraudAlertDao {
  constructor(private readonly notifications: NotificationDao) {}

  async createWithin(transaction: DaoTransaction, input: {
    verificationId: string; fraudFlagId: string; businessId: string;
    branchId: string; orderId: string; attemptNumber: number;
    threshold: number; ruleWindowDays: number; purchaseLocked: boolean;
  }) {
    const severity = input.purchaseLocked ? 'CRITICAL' : 'HIGH';
    const alert = await transaction.one<{
      id: string; severity: 'HIGH' | 'CRITICAL';
    }>(
      `INSERT INTO security_alerts (
         alert_key, business_id, alert_type, severity, details_json
       ) VALUES ($1,$2,'SUBSCRIPTION_CROSS_DAY_REUSE',$3,$4::jsonb)
       ON CONFLICT (alert_key) WHERE alert_key IS NOT NULL
       DO UPDATE SET alert_key = EXCLUDED.alert_key
       RETURNING id, severity`,
      [`subscription-fraud:${input.verificationId}`, input.businessId, severity,
       JSON.stringify({
         fraudFlagId: input.fraudFlagId, verificationId: input.verificationId,
         branchId: input.branchId, orderId: input.orderId,
         classification: 'CROSS_DAY_FRAUD', attemptNumber: input.attemptNumber,
         threshold: input.threshold, ruleWindowDays: input.ruleWindowDays,
         purchaseLocked: input.purchaseLocked,
       })],
    );
    await this.notifications.createPlatformAdminFraudBroadcastWithin(
      transaction,
      {
        verificationId: input.verificationId,
        businessId: input.businessId,
        branchId: input.branchId,
        attemptNumber: input.attemptNumber,
      },
    );
    return alert;
  }
}
