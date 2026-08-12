import { Injectable } from '@nestjs/common';
import { CentralDao } from '../database/central.dao';
import { NotificationAudienceDao } from '../notifications/notification-audience.dao';
import { VerifyEtErrorCode } from './verify-et-provider.error';

type AlertRow = {
  id: string;
  alert_key: string;
  severity: 'HIGH' | 'CRITICAL';
  created_at: Date;
};

export type VerifyEtOperationalAlert = Readonly<{
  id: string;
  alertKey: string;
  alertType: 'VERIFYET_PROVIDER_FAILURE';
  severity: 'HIGH' | 'CRITICAL';
  createdAt: Date;
}>;

@Injectable()
export class VerifyEtOperationalAlertDao {
  constructor(
    private readonly dao: CentralDao,
    private readonly notifications: NotificationAudienceDao,
  ) {}

  async create(input: {
    requestRecordId: string;
    transactionId: string;
    errorCode: VerifyEtErrorCode;
  }): Promise<VerifyEtOperationalAlert> {
    const alertKey = `verifyet:provider:${input.errorCode}:${input.requestRecordId}`;
    const severity =
      input.errorCode === 'AUTHENTICATION_FAILED' ? 'CRITICAL' : 'HIGH';
    const row = await this.dao.transaction(async (transaction) => {
      const alert = await transaction.one<AlertRow>(
        `INSERT INTO security_alerts (
         alert_key, alert_type, severity, details_json
       ) VALUES (
         $1, 'VERIFYET_PROVIDER_FAILURE', $2,
         jsonb_build_object(
           'errorCode', $3::text,
           'providerRequestRecordId', $4::text,
           'transactionId', $5::text
         )
       )
       ON CONFLICT (alert_key) WHERE alert_key IS NOT NULL
       DO UPDATE SET alert_key = EXCLUDED.alert_key
       RETURNING id, alert_key, severity, created_at`,
      [
        alertKey,
        severity,
        input.errorCode,
        input.requestRecordId,
        input.transactionId,
        ],
      );
      await this.notifications.notifyProviderIncidentWithin(transaction, {
        alertId: alert.id, errorCode: input.errorCode,
      });
      return alert;
    });
    return {
      id: row.id,
      alertKey: row.alert_key,
      alertType: 'VERIFYET_PROVIDER_FAILURE',
      severity: row.severity,
      createdAt: row.created_at,
    };
  }
}
