import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { AccountCryptoService } from '../common/account-crypto.service';
import { DatabaseService } from '../database/database.service';
import {
  CreatePlatformAccountDto,
  CreateSettlementAccountDto,
  CreateBankDto,
  UpdatePlatformAccountDto,
  UpdateBankDto,
} from './dto/account.dto';

type AccountRow = {
  id: string;
  bank_id: string;
  bank_code: string;
  bank_name: string;
  account_mask: string;
  account_suffix: string;
  label: string | null;
  active: boolean;
  is_default?: boolean;
  accepted_plan_codes?: string[];
  created_at: Date;
};

@Injectable()
export class BanksService {
  constructor(
    private readonly database: DatabaseService,
    private readonly crypto: AccountCryptoService,
    private readonly audit: AuditService,
  ) {}

  async listBanks(includeDisabled: boolean, actor: AuthenticatedPrincipal) {
    const showDisabled =
      includeDisabled && actor.role === 'PLATFORM_SUPER_ADMIN';
    const result = await this.database.query<{
      id: string;
      code: string;
      name: string;
      enabled: boolean;
    }>(
      `SELECT id, code, name, enabled FROM banks
       WHERE enabled OR $1::boolean ORDER BY name`,
      [showDisabled],
    );
    return result.rows;
  }

  async updateBank(
    bankId: string,
    input: UpdateBankDto,
    actor: AuthenticatedPrincipal,
  ) {
    this.assertPlatformAdmin(actor);
    const result = await this.database.query<{
      id: string;
      code: string;
      name: string;
      enabled: boolean;
    }>(
      `UPDATE banks SET enabled = $2, updated_at = now()
       WHERE id = $1 RETURNING id, code, name, enabled`,
      [bankId, input.enabled],
    );
    if (!result.rows[0]) throw new NotFoundException('Bank not found');
    await this.audit.record({
      actorUserId: actor.userId,
      action: input.enabled ? 'bank.activated' : 'bank.deactivated',
      targetType: 'bank',
      targetId: bankId,
    });
    return result.rows[0];
  }

  async createBank(input: CreateBankDto, actor: AuthenticatedPrincipal) {
    this.assertPlatformAdmin(actor);
    try {
      const result = await this.database.query<{
        id: string;
        code: string;
        name: string;
        enabled: boolean;
      }>(
        `INSERT INTO banks (code, name)
         VALUES (upper($1), $2)
         RETURNING id, code, name, enabled`,
        [input.code, input.name],
      );
      await this.audit.record({
        actorUserId: actor.userId,
        action: 'bank.created',
        targetType: 'bank',
        targetId: result.rows[0].id,
      });
      return result.rows[0];
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('Bank code already exists');
      }
      throw error;
    }
  }

  async createBranchAccount(
    businessId: string,
    branchId: string,
    input: CreateSettlementAccountDto,
    actor: AuthenticatedPrincipal,
  ) {
    this.assertOwnerAccess(actor, businessId);
    const encrypted = this.crypto.encrypt(input.accountValue);
    let row: AccountRow;
    try {
      const result = await this.database.query<AccountRow>(
        `INSERT INTO settlement_accounts (
           business_id, branch_id, bank_id, account_ciphertext, account_iv,
           account_auth_tag, account_mask, account_suffix, label, created_by
         )
         SELECT $1, $2, b.id, $4, $5, $6, $7, $8, $9, $10
         FROM banks b
         JOIN branches br ON br.id = $2 AND br.business_id = $1
         WHERE b.id = $3 AND b.enabled = true AND br.status = 'ACTIVE'
         RETURNING id, bank_id,
           (SELECT code FROM banks WHERE id = bank_id) AS bank_code,
           (SELECT name FROM banks WHERE id = bank_id) AS bank_name,
           account_mask, account_suffix, label, active, created_at`,
        [
          businessId,
          branchId,
          input.bankId,
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.authTag,
          encrypted.mask,
          encrypted.suffix,
          input.label ?? null,
          actor.userId,
        ],
      );
      if (!result.rows[0]) {
        throw new NotFoundException('Active branch or enabled bank not found');
      }
      row = result.rows[0];
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException(
          'An active account already exists for this branch and bank',
        );
      }
      throw error;
    }
    await this.audit.record({
      actorUserId: actor.userId,
      businessId,
      branchId,
      action: 'settlement_account.created',
      targetType: 'settlement_account',
      targetId: row.id,
      metadata: { bankId: input.bankId, accountMask: row.account_mask },
    });
    return this.present(row);
  }

  async listBranchAccounts(
    businessId: string,
    branchId: string,
    actor: AuthenticatedPrincipal,
  ) {
    this.assertOwnerAccess(actor, businessId);
    const result = await this.database.query<AccountRow>(
      `SELECT sa.id, sa.bank_id, b.code AS bank_code, b.name AS bank_name,
              sa.account_mask, sa.account_suffix, sa.label, sa.active,
              sa.created_at
       FROM settlement_accounts sa
       JOIN banks b ON b.id = sa.bank_id
       WHERE sa.business_id = $1 AND sa.branch_id = $2
       ORDER BY sa.created_at DESC`,
      [businessId, branchId],
    );
    return result.rows.map((row) => this.present(row));
  }

  async deactivateBranchAccount(
    businessId: string,
    branchId: string,
    accountId: string,
    actor: AuthenticatedPrincipal,
  ) {
    this.assertOwnerAccess(actor, businessId);
    const result = await this.database.query(
      `UPDATE settlement_accounts
       SET active = false, deactivated_at = now()
       WHERE id = $1 AND business_id = $2 AND branch_id = $3 AND active = true`,
      [accountId, businessId, branchId],
    );
    if (!result.rowCount) throw new NotFoundException('Active account not found');
    await this.audit.record({
      actorUserId: actor.userId,
      businessId,
      branchId,
      action: 'settlement_account.deactivated',
      targetType: 'settlement_account',
      targetId: accountId,
    });
    return { id: accountId, active: false };
  }

  async createPlatformAccount(
    input: CreatePlatformAccountDto,
    actor: AuthenticatedPrincipal,
  ) {
    this.assertPlatformAdmin(actor);
    const encrypted = this.crypto.encrypt(input.accountValue);
    let row: AccountRow;
    try {
      row = await this.database.transaction(async (client) => {
        if (input.isDefault) {
          await client.query(
            `UPDATE subscription_settlement_accounts SET is_default = false
             WHERE active AND is_default`,
          );
        }
        const result = await client.query<AccountRow>(
          `INSERT INTO subscription_settlement_accounts (
             bank_id, account_ciphertext, account_iv, account_auth_tag,
             account_mask, account_suffix, accepted_plan_codes,
             is_default, created_by
           )
           SELECT id, $2, $3, $4, $5, $6, $7, $8, $9
           FROM banks WHERE id = $1 AND enabled = true
           RETURNING id, bank_id,
             (SELECT code FROM banks WHERE id = bank_id) AS bank_code,
             (SELECT name FROM banks WHERE id = bank_id) AS bank_name,
             account_mask, account_suffix, NULL::text AS label, active,
             is_default, accepted_plan_codes, created_at`,
          [
            input.bankId,
            encrypted.ciphertext,
            encrypted.iv,
            encrypted.authTag,
            encrypted.mask,
            encrypted.suffix,
            input.acceptedPlanCodes ?? [
              'STARTER',
              'PROFESSIONAL',
              'BUSINESS',
            ],
            input.isDefault ?? false,
            actor.userId,
          ],
        );
        if (!result.rows[0]) throw new NotFoundException('Enabled bank not found');
        return result.rows[0];
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException(
          'An active Platform account already exists for this bank',
        );
      }
      throw error;
    }
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'platform_settlement_account.created',
      targetType: 'subscription_settlement_account',
      targetId: row.id,
      metadata: { bankId: input.bankId, accountMask: row.account_mask },
    });
    return this.present(row);
  }

  async listPlatformAccounts(actor: AuthenticatedPrincipal) {
    this.assertPlatformAdmin(actor);
    const result = await this.database.query<AccountRow>(
      `SELECT sa.id, sa.bank_id, b.code AS bank_code, b.name AS bank_name,
              sa.account_mask, sa.account_suffix, NULL::text AS label,
              sa.active, sa.is_default, sa.accepted_plan_codes, sa.created_at
       FROM subscription_settlement_accounts sa
       JOIN banks b ON b.id = sa.bank_id
       ORDER BY sa.created_at DESC`,
    );
    return result.rows.map((row) => this.present(row));
  }

  async updatePlatformAccount(
    accountId: string,
    input: UpdatePlatformAccountDto,
    actor: AuthenticatedPrincipal,
  ) {
    this.assertPlatformAdmin(actor);
    let row: AccountRow;
    try {
      row = await this.database.transaction(async (client) => {
        const existing = await client.query(
          `SELECT 1 FROM subscription_settlement_accounts
           WHERE id = $1 FOR UPDATE`,
          [accountId],
        );
        if (!existing.rowCount) {
          throw new NotFoundException('Platform settlement account not found');
        }
        if (input.isDefault) {
          await client.query(
            `UPDATE subscription_settlement_accounts
             SET is_default = false
             WHERE id <> $1 AND active AND is_default`,
            [accountId],
          );
        }
        const result = await client.query<AccountRow>(
          `UPDATE subscription_settlement_accounts sa
           SET active = COALESCE($2, active),
               is_default = CASE
                 WHEN COALESCE($2, active) = false THEN false
                 ELSE COALESCE($3, is_default)
               END,
               accepted_plan_codes = COALESCE($4, accepted_plan_codes),
               deactivated_at = CASE
                 WHEN COALESCE($2, active) = false THEN now()
                 WHEN $2 = true THEN NULL
                 ELSE deactivated_at
               END
           WHERE id = $1
           RETURNING id, bank_id,
             (SELECT code FROM banks WHERE id = bank_id) AS bank_code,
             (SELECT name FROM banks WHERE id = bank_id) AS bank_name,
             account_mask, account_suffix, NULL::text AS label, active,
             is_default, accepted_plan_codes, created_at`,
          [
            accountId,
            input.active ?? null,
            input.isDefault ?? null,
            input.acceptedPlanCodes ?? null,
          ],
        );
        return result.rows[0];
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException(
          'Another active account already exists for this bank or default',
        );
      }
      throw error;
    }
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'platform_settlement_account.updated',
      targetType: 'subscription_settlement_account',
      targetId: accountId,
      metadata: {
        active: input.active,
        isDefault: input.isDefault,
        acceptedPlanCodes: input.acceptedPlanCodes,
      },
    });
    return this.present(row);
  }

  private assertPlatformAdmin(actor: AuthenticatedPrincipal) {
    if (actor.role !== 'PLATFORM_SUPER_ADMIN') {
      throw new ForbiddenException('Platform administrator access required');
    }
  }

  private assertOwnerAccess(actor: AuthenticatedPrincipal, businessId: string) {
    if (
      actor.role !== 'PLATFORM_SUPER_ADMIN' &&
      (actor.role !== 'BUSINESS_OWNER' ||
        !actor.businessIds.includes(businessId))
    ) {
      throw new ForbiddenException('Business Owner access required');
    }
  }

  private present(row: AccountRow) {
    return {
      id: row.id,
      bank: { id: row.bank_id, code: row.bank_code, name: row.bank_name },
      accountMask: row.account_mask,
      accountSuffix: row.account_suffix,
      label: row.label,
      active: row.active,
      ...(row.is_default === undefined ? {} : { isDefault: row.is_default }),
      ...(row.accepted_plan_codes === undefined
        ? {}
        : { acceptedPlanCodes: row.accepted_plan_codes }),
      createdAt: row.created_at,
    };
  }
}
