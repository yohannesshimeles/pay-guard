import { Injectable } from '@nestjs/common';
import { CentralDao, DaoTransaction } from '../database/central.dao';

type IncidentRow = {
  id: string;
  alert_key: string;
  severity: 'HIGH' | 'CRITICAL';
  error_code: string;
  provider_request_record_id: string;
  transaction_id: string;
  created_at: Date;
  acknowledged_at: Date | null;
  acknowledged_by_platform_admin_id: string | null;
  acknowledgement_note: string | null;
};

export type VerifyEtIncident = Readonly<{
  id: string;
  severity: 'HIGH' | 'CRITICAL';
  errorCode: string;
  providerRequestRecordId: string;
  transactionId: string;
  status: 'OPEN' | 'ACKNOWLEDGED';
  createdAt: Date;
  acknowledgedAt?: Date;
  acknowledgedByPlatformAdminId?: string;
  acknowledgementNote?: string;
}>;

export class VerifyEtIncidentAcknowledgementConflictError extends Error {
  readonly name = 'VerifyEtIncidentAcknowledgementConflictError';

  constructor() {
    super('Provider incident was already acknowledged differently');
  }
}

export class VerifyEtIncidentNotFoundError extends Error {
  readonly name = 'VerifyEtIncidentNotFoundError';

  constructor() {
    super('Provider incident was not found');
  }
}

@Injectable()
export class VerifyEtIncidentDao {
  constructor(private readonly dao: CentralDao) {}

  async list(input: {
    severity?: 'HIGH' | 'CRITICAL';
    status?: 'OPEN' | 'ACKNOWLEDGED';
    limit: number;
    offset: number;
  }): Promise<VerifyEtIncident[]> {
    const rows = await this.dao.many<IncidentRow>(
      `${this.selectSql()}
       WHERE alert.alert_type = 'VERIFYET_PROVIDER_FAILURE'
         AND ($1::text IS NULL OR alert.severity = $1)
         AND ($2::text IS NULL OR
              ($2 = 'OPEN' AND alert.acknowledged_at IS NULL) OR
              ($2 = 'ACKNOWLEDGED' AND alert.acknowledged_at IS NOT NULL))
       ORDER BY alert.created_at DESC, alert.id DESC
       LIMIT $3 OFFSET $4`,
      [input.severity ?? null, input.status ?? null, input.limit, input.offset],
    );
    return rows.map((row) => this.map(row));
  }

  async require(id: string): Promise<VerifyEtIncident> {
    const row = await this.dao.optional<IncidentRow>(
      `${this.selectSql()}
       WHERE alert.id = $1
         AND alert.alert_type = 'VERIFYET_PROVIDER_FAILURE'`,
      [id],
    );
    if (!row) throw new VerifyEtIncidentNotFoundError();
    return this.map(row);
  }

  async acknowledgeWithin(
    transaction: DaoTransaction,
    input: {
      id: string;
      platformAdminId: string;
      note?: string;
    },
  ): Promise<VerifyEtIncident> {
    const current = await transaction.optional<IncidentRow>(
      `${this.selectSql()}
       WHERE alert.id = $1
         AND alert.alert_type = 'VERIFYET_PROVIDER_FAILURE'
       FOR UPDATE OF alert`,
      [input.id],
    );
    if (!current) throw new VerifyEtIncidentNotFoundError();
    const note = input.note?.trim() || undefined;
    if (current.acknowledged_at) {
      if (
        current.acknowledged_by_platform_admin_id !== input.platformAdminId ||
        (current.acknowledgement_note ?? undefined) !== note
      ) {
        throw new VerifyEtIncidentAcknowledgementConflictError();
      }
      return this.map(current);
    }
    return this.map(
      await transaction.one<IncidentRow>(
        `WITH updated AS (
           UPDATE security_alerts alert
           SET acknowledged_at = now(),
               acknowledged_by_platform_admin_id = $2,
               acknowledgement_note = $3
           WHERE id = $1
             AND alert_type = 'VERIFYET_PROVIDER_FAILURE'
           RETURNING *
         )
         SELECT ${this.selectColumns('updated')}
         FROM updated`,
        [input.id, input.platformAdminId, note ?? null],
      ),
    );
  }

  private selectSql(alias = 'alert'): string {
    return `SELECT ${this.selectColumns(alias)}
            FROM security_alerts ${alias}`;
  }

  private selectColumns(alias: string): string {
    return `${alias}.id, ${alias}.alert_key, ${alias}.severity,
            ${alias}.details_json->>'errorCode' AS error_code,
            ${alias}.details_json->>'providerRequestRecordId'
              AS provider_request_record_id,
            ${alias}.details_json->>'transactionId' AS transaction_id,
            ${alias}.created_at, ${alias}.acknowledged_at,
            ${alias}.acknowledged_by_platform_admin_id,
            ${alias}.acknowledgement_note`;
  }

  private map(row: IncidentRow): VerifyEtIncident {
    return {
      id: row.id,
      severity: row.severity,
      errorCode: row.error_code,
      providerRequestRecordId: row.provider_request_record_id,
      transactionId: row.transaction_id,
      status: row.acknowledged_at ? 'ACKNOWLEDGED' : 'OPEN',
      createdAt: row.created_at,
      acknowledgedAt: row.acknowledged_at ?? undefined,
      acknowledgedByPlatformAdminId:
        row.acknowledged_by_platform_admin_id ?? undefined,
      acknowledgementNote: row.acknowledgement_note ?? undefined,
    };
  }
}
