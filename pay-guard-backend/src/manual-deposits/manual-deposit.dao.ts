import { Injectable } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CentralDao, DaoTransaction } from '../database/central.dao';
import { LedgerDao } from '../ledger/ledger.dao';
import { NotificationAudienceDao } from '../notifications/notification-audience.dao';
import { LedgerEntryType } from '../ledger/ledger-entry-type.enum';
import { ManualDepositEntity, ManualDepositProps } from './manual-deposit.entity';

type ScopeRow = {
  settlement_account_id: string;
  current_balance: string;
  projected_balance: string;
};

type DepositRow = {
  id: string;
  business_id: string;
  branch_id: string;
  settlement_account_id: string;
  amount: string;
  description: string;
  actual_transaction_at: Date;
  cashier_role_assignment_id: string;
  ledger_entry_id: string;
  running_balance: string;
  status: 'POSTED';
  created_at: Date;
  attachment_id: string | null;
  attachment_file_name: string | null;
  attachment_mime_type: string | null;
  attachment_size_bytes: string | null;
  attachment_created_at: Date | null;
};

export type CreateManualDeposit = Readonly<{
  id: string;
  businessId: string;
  branchId: string;
  settlementAccountId: string;
  amount: string;
  description: string;
  actualTransactionAt: Date;
  expectedCurrentBalance: string;
  expectedProjectedBalance: string;
  actor: AuthenticatedPrincipal;
}>;

export class ManualDepositScopeError extends Error {}
export class ManualDepositBalanceConflictError extends Error {}
export class ManualDepositReplayConflictError extends Error {}
export class ManualDepositNotFoundError extends Error {}
export class ManualDepositAttachmentConflictError extends Error {}

@Injectable()
export class ManualDepositDao {
  constructor(
    private readonly dao: CentralDao,
    private readonly ledger: LedgerDao,
    private readonly notifications: NotificationAudienceDao,
  ) {}

  async createWithin(transaction: DaoTransaction, input: CreateManualDeposit) {
    const scope = await this.lockScope(transaction, input);
    const existing = await this.findWithin(transaction, input.id, {
      businessId: input.businessId,
      branchId: input.branchId,
    });
    if (existing) {
      this.assertReplay(existing, input);
      return { deposit: existing, replayed: true };
    }
    if (
      scope.current_balance !== input.expectedCurrentBalance ||
      scope.projected_balance !== input.expectedProjectedBalance
    ) {
      throw new ManualDepositBalanceConflictError();
    }

    const audit = await transaction.one<{ id: string }>(
      `INSERT INTO audit_logs (
         user_id, membership_id, role_code, business_id, branch_id,
         action_type, record_type, record_id, new_value, session_id, result
       ) VALUES ($1,$2,$3,$4,$5,'MANUAL_DEPOSIT_CREATED','MANUAL_DEPOSIT',$6,
         jsonb_build_object('settlementAccountId',$7::text,'amount',$8::text,
                            'actualTransactionAt',$9::text),$10,'SUCCESS')
       RETURNING id`,
      [
        input.actor.userId, input.actor.membershipId, input.actor.role,
        input.businessId, input.branchId, input.id, input.settlementAccountId,
        input.amount, input.actualTransactionAt.toISOString(),
        input.actor.sessionId,
      ],
    );
    const posted = await this.ledger.postWithin(transaction, {
      businessId: input.businessId,
      branchId: input.branchId,
      settlementAccountId: input.settlementAccountId,
      entryType: LedgerEntryType.MANUAL_DEPOSIT,
      amount: input.amount,
      actualTransactionAt: input.actualTransactionAt,
      sourceRecordType: 'MANUAL_DEPOSIT',
      sourceRecordId: input.id,
      description: input.description,
      createdByUserId: input.actor.userId,
      workAssignmentId: input.actor.workAssignmentId,
      auditLogId: audit.id,
      idempotencyKey: `manual-deposit:${input.id}`,
    });
    await transaction.one<{ id: string }>(
      `INSERT INTO manual_deposits (
         id, business_id, branch_id, settlement_account_id, amount,
         description, actual_transaction_at, cashier_role_assignment_id,
         ledger_entry_id, idempotency_key
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$1)
       RETURNING id`,
      [
        input.id, input.businessId, input.branchId, input.settlementAccountId,
        input.amount, input.description, input.actualTransactionAt,
        input.actor.membershipRoleId, posted.entry.id,
      ],
    );
    const deposit = await this.findWithin(transaction, input.id, {
      businessId: input.businessId,
      branchId: input.branchId,
    });
    if (!deposit) throw new ManualDepositNotFoundError();
    await this.notifications.notifyFinancialOversightWithin(transaction, {
      operation: 'MANUAL_DEPOSIT', recordId: input.id,
      businessId: input.businessId, branchId: input.branchId,
    });
    return { deposit, replayed: false };
  }

  async list(
    scope: { businessId: string; branchId?: string },
    input: {
      settlementAccountId?: string;
      dateFrom?: string;
      dateTo?: string;
      limit: number;
      offset: number;
    },
  ) {
    const rows = await this.dao.many<DepositRow>(
      `${this.selectSql()}
       WHERE deposit.business_id = $1
         AND ($2::uuid IS NULL OR deposit.branch_id = $2)
         AND ($3::uuid IS NULL OR deposit.settlement_account_id = $3)
         AND ($4::date IS NULL OR deposit.actual_transaction_at >= $4::date)
         AND ($5::date IS NULL OR deposit.actual_transaction_at < $5::date + interval '1 day')
       ORDER BY deposit.actual_transaction_at DESC, deposit.id DESC
       LIMIT $6 OFFSET $7`,
      [
        scope.businessId, scope.branchId ?? null,
        input.settlementAccountId ?? null, input.dateFrom ?? null,
        input.dateTo ?? null, input.limit, input.offset,
      ],
    );
    return rows.map((row) => this.map(row).toPublicModel());
  }

  async find(id: string, scope: { businessId: string; branchId?: string }) {
    const row = await this.dao.optional<DepositRow>(
      `${this.selectSql()}
       WHERE deposit.id = $1 AND deposit.business_id = $2
         AND ($3::uuid IS NULL OR deposit.branch_id = $3)`,
      [id, scope.businessId, scope.branchId ?? null],
    );
    return row ? this.map(row) : undefined;
  }

  async attachWithin(
    transaction: DaoTransaction,
    input: {
      depositId: string;
      businessId: string;
      branchId: string;
      uploadedByUserId: string;
      cashierRoleAssignmentId: string;
      objectKey: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
    },
  ) {
    const deposit = await transaction.optional<{ id: string }>(
      `SELECT id FROM manual_deposits
       WHERE id = $1 AND business_id = $2 AND branch_id = $3
         AND cashier_role_assignment_id = $4
       FOR UPDATE`,
      [input.depositId, input.businessId, input.branchId,
       input.cashierRoleAssignmentId],
    );
    if (!deposit) throw new ManualDepositNotFoundError();
    const existing = await transaction.optional<{ id: string }>(
      `SELECT id FROM manual_deposit_attachments
       WHERE manual_deposit_id = $1`,
      [input.depositId],
    );
    if (existing) throw new ManualDepositAttachmentConflictError();
    await transaction.one<{ id: string }>(
      `INSERT INTO manual_deposit_attachments (
         manual_deposit_id, object_key, file_name, mime_type, size_bytes,
         sha256, uploaded_by_user_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        input.depositId, input.objectKey, input.fileName, input.mimeType,
        input.sizeBytes, input.sha256, input.uploadedByUserId,
      ],
    );
    const found = await this.findWithin(transaction, input.depositId, {
      businessId: input.businessId,
      branchId: input.branchId,
    });
    if (!found) throw new ManualDepositNotFoundError();
    return found;
  }

  private async lockScope(
    transaction: DaoTransaction,
    input: CreateManualDeposit,
  ): Promise<ScopeRow> {
    const row = await transaction.optional<ScopeRow>(
      `SELECT account.id AS settlement_account_id,
              account.calculated_balance::text AS current_balance,
              (account.calculated_balance + $8::numeric(18,2))::text AS projected_balance
       FROM settlement_accounts account
       JOIN user_work_assignments work
         ON work.id = $1 AND work.business_id = $2 AND work.branch_id = $3
        AND work.membership_role_id = $4 AND work.status = 'ACTIVE'
       JOIN membership_role_assignments role_assignment
         ON role_assignment.id = $4 AND role_assignment.role_code = 'CASHIER'
        AND role_assignment.status = 'ACTIVE'
       JOIN business_user_memberships membership
         ON membership.id = role_assignment.membership_id
        AND membership.id = $5 AND membership.user_id = $6
        AND membership.business_id = $2 AND membership.status = 'ACTIVE'
       WHERE account.id = $7 AND account.business_id = $2
         AND account.branch_id = $3 AND account.status = 'ACTIVE'
       FOR UPDATE OF account`,
      [
        input.actor.workAssignmentId, input.businessId, input.branchId,
        input.actor.membershipRoleId, input.actor.membershipId,
        input.actor.userId, input.settlementAccountId, input.amount,
      ],
    );
    if (!row) throw new ManualDepositScopeError();
    return row;
  }

  private async findWithin(
    transaction: DaoTransaction,
    id: string,
    scope: { businessId: string; branchId?: string },
  ) {
    const row = await transaction.optional<DepositRow>(
      `${this.selectSql()}
       WHERE deposit.id = $1 AND deposit.business_id = $2
         AND ($3::uuid IS NULL OR deposit.branch_id = $3)`,
      [id, scope.businessId, scope.branchId ?? null],
    );
    return row ? this.map(row) : undefined;
  }

  private assertReplay(entity: ManualDepositEntity, input: CreateManualDeposit) {
    const value = entity.toPublicModel();
    if (
      value.settlementAccountId !== input.settlementAccountId ||
      value.amount !== input.amount || value.description !== input.description ||
      value.actualTransactionAt.getTime() !== input.actualTransactionAt.getTime()
    ) {
      throw new ManualDepositReplayConflictError();
    }
  }

  private selectSql(): string {
    return `SELECT deposit.id, deposit.business_id, deposit.branch_id,
                   deposit.settlement_account_id, deposit.amount::text,
                   deposit.description, deposit.actual_transaction_at,
                   deposit.cashier_role_assignment_id, deposit.ledger_entry_id,
                   ledger.running_balance::text, deposit.status, deposit.created_at,
                   attachment.id AS attachment_id,
                   attachment.file_name AS attachment_file_name,
                   attachment.mime_type AS attachment_mime_type,
                   attachment.size_bytes::text AS attachment_size_bytes,
                   attachment.created_at AS attachment_created_at
            FROM manual_deposits deposit
            JOIN ledger_entries ledger ON ledger.id = deposit.ledger_entry_id
            LEFT JOIN manual_deposit_attachments attachment
              ON attachment.manual_deposit_id = deposit.id`;
  }

  private map(row: DepositRow): ManualDepositEntity {
    const props: ManualDepositProps = {
      id: row.id, businessId: row.business_id, branchId: row.branch_id,
      settlementAccountId: row.settlement_account_id, amount: row.amount,
      description: row.description,
      actualTransactionAt: row.actual_transaction_at,
      cashierRoleAssignmentId: row.cashier_role_assignment_id,
      ledgerEntryId: row.ledger_entry_id, runningBalance: row.running_balance,
      status: row.status, createdAt: row.created_at,
      ...(row.attachment_id ? {
        attachment: {
          id: row.attachment_id,
          fileName: row.attachment_file_name!,
          mimeType: row.attachment_mime_type!,
          sizeBytes: Number(row.attachment_size_bytes),
          createdAt: row.attachment_created_at!,
        },
      } : {}),
    };
    return new ManualDepositEntity(props);
  }
}
