import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { V2AuditService } from '../audit/v2-audit.service';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { V2SelectedAuthContext } from '../auth/v2-auth.types';
import {
  AccountCryptoService,
  EncryptedAccountValue,
} from '../common/account-crypto.service';
import { DatabaseService } from '../database/database.service';
import {
  CreateBankDto,
  CreatePlatformAccountDto,
  CreateSettlementAccountDto,
  UpdateBankDto,
  UpdatePlatformAccountDto,
} from './dto/account.dto';

type V2BankRow = {
  id: string;
  official_name: string;
  short_name: string;
  account_type: 'BANK_ACCOUNT' | 'WALLET';
  account_number_pattern: string | null;
  verification_method: 'REFERENCE' | 'URL_TOKEN' | 'TRANSACTION_NO';
  account_suffix_length: number | null;
  phone_number_format: string | null;
  verifyet_bank_identifier: string;
  status: 'ACTIVE' | 'INACTIVE' | 'DELETED';
  created_at: Date;
};

type V2AccountRow = {
  id: string;
  business_id?: string;
  scope_type?: 'MAIN_BUSINESS' | 'BRANCH';
  branch_id?: string | null;
  bank_id: string;
  official_name: string;
  short_name: string;
  account_name: string;
  masked_account_number: string;
  normalized_account_suffix?: string | null;
  opening_balance: string;
  opening_balance_date?: string;
  calculated_balance: string;
  currency?: string;
  status: string;
  version_no: number;
  created_at: Date;
};

@Injectable()
export class V2BanksService {
  constructor(
    private readonly database: DatabaseService,
    private readonly crypto: AccountCryptoService,
    private readonly audit: V2AuditService,
  ) {}

  async listBanks(includeDisabled: boolean, actor: AuthenticatedPrincipal) {
    const showDisabled =
      includeDisabled && actor.identityType === 'PLATFORM_ADMIN';
    const result = await this.database.query<V2BankRow>(
      `SELECT * FROM supported_banks
       WHERE status = 'ACTIVE' OR $1::boolean
       ORDER BY official_name`,
      [showDisabled],
    );
    return result.rows.map((row) => this.presentBank(row));
  }

  async createBank(input: CreateBankDto, actor: AuthenticatedPrincipal) {
    this.assertPlatformAdmin(actor);
    try {
      const row = await this.database.transaction(async (client) => {
        const result = await client.query<V2BankRow>(
          `INSERT INTO supported_banks (
             official_name, short_name, account_type,
             account_number_pattern, verification_method,
             phone_number_format, verifyet_bank_identifier
           ) VALUES ($1, $2, $3, $4, $5, $6, upper($7))
           RETURNING *`,
          [
            input.name,
            input.shortName ?? input.code,
            input.accountType ?? 'BANK_ACCOUNT',
            input.accountNumberPattern ?? null,
            input.verificationMethod ?? 'REFERENCE',
            input.phoneNumberFormat ?? null,
            input.verifyetBankIdentifier ?? input.code,
          ],
        );
        await this.audit.recordWithClient(client, {
          actor: this.auditContext(actor),
          sessionId: actor.sessionId,
          actionType: 'BANK_CREATED',
          recordType: 'SUPPORTED_BANK',
          recordId: result.rows[0].id,
          newValue: {
            identifier: result.rows[0].verifyet_bank_identifier,
            status: result.rows[0].status,
          },
        });
        return result.rows[0];
      });
      return this.presentBank(row);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('Bank name or identifier already exists');
      }
      throw error;
    }
  }

  async updateBank(
    bankId: string,
    input: UpdateBankDto,
    actor: AuthenticatedPrincipal,
  ) {
    this.assertPlatformAdmin(actor);
    const row = await this.database.transaction(async (client) => {
      const result = await client.query<V2BankRow>(
        `UPDATE supported_banks
         SET status = $2::varchar
         WHERE id = $1 AND status <> 'DELETED'
         RETURNING *`,
        [bankId, input.enabled ? 'ACTIVE' : 'INACTIVE'],
      );
      if (!result.rows[0]) throw new NotFoundException('Bank not found');
      await this.audit.recordWithClient(client, {
        actor: this.auditContext(actor),
        sessionId: actor.sessionId,
        actionType: input.enabled ? 'BANK_ACTIVATED' : 'BANK_DEACTIVATED',
        recordType: 'SUPPORTED_BANK',
        recordId: bankId,
        newValue: { status: result.rows[0].status },
      });
      return result.rows[0];
    });
    return this.presentBank(row);
  }

  async createBranchAccount(
    businessId: string,
    branchId: string,
    input: CreateSettlementAccountDto,
    actor: AuthenticatedPrincipal,
  ) {
    const context = this.requireOwnerContext(actor, businessId);
    const encrypted = this.crypto.encrypt(input.accountValue);
    const accountName = this.accountName(input);
    try {
      const row = await this.database.transaction(async (client) => {
        await this.requireOwnerAndBranch(
          client,
          businessId,
          branchId,
          context,
          actor.userId,
        );
        const result = await client.query<V2AccountRow>(
          `WITH inserted AS (
             INSERT INTO settlement_accounts (
               business_id, scope_type, branch_id, bank_id, account_name,
               account_number_encrypted, account_number_hash,
               masked_account_number, normalized_account_suffix,
               opening_balance, opening_balance_date, calculated_balance,
               created_by_membership_id
             )
             SELECT $1, 'BRANCH', $2, bank.id, $4, $5, $6, $7, $8,
                    $9, $10::date, $9, $11
             FROM supported_banks bank
             WHERE bank.id = $3 AND bank.status = 'ACTIVE'
             RETURNING *
           )
           SELECT inserted.*, bank.official_name, bank.short_name
           FROM inserted
           JOIN supported_banks bank ON bank.id = inserted.bank_id`,
          [
            businessId,
            branchId,
            input.bankId,
            accountName,
            this.envelope(encrypted),
            encrypted.fingerprint,
            encrypted.mask,
            encrypted.suffix,
            input.openingBalance ?? 0,
            input.openingBalanceDate ?? this.today(),
            context.membershipId,
          ],
        );
        if (!result.rows[0]) throw new NotFoundException('Active bank not found');
        await this.audit.recordWithClient(client, {
          actor: context,
          sessionId: actor.sessionId,
          actionType: 'SETTLEMENT_ACCOUNT_CREATED',
          recordType: 'SETTLEMENT_ACCOUNT',
          recordId: result.rows[0].id,
          businessId,
          branchId,
          newValue: {
            bankId: input.bankId,
            accountMask: encrypted.mask,
            openingBalance: input.openingBalance ?? 0,
          },
        });
        return result.rows[0];
      });
      return this.presentAccount(row);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException(
          'The account number or active bank scope already exists',
        );
      }
      throw error;
    }
  }

  async listBranchAccounts(
    businessId: string,
    branchId: string,
    actor: AuthenticatedPrincipal,
  ) {
    this.assertOwnerOrAdmin(actor, businessId);
    const branch = await this.database.query(
      `SELECT 1 FROM branches WHERE id = $2 AND business_id = $1`,
      [businessId, branchId],
    );
    if (!branch.rowCount) throw new NotFoundException('Branch not found');
    const result = await this.database.query<V2AccountRow>(
      `${this.accountSelect('settlement_accounts')}
       WHERE account.business_id = $1
         AND account.scope_type = 'BRANCH'
         AND account.branch_id = $2
       ORDER BY account.created_at DESC`,
      [businessId, branchId],
    );
    return result.rows.map((row) => this.presentAccount(row));
  }

  async deactivateBranchAccount(
    businessId: string,
    branchId: string,
    accountId: string,
    actor: AuthenticatedPrincipal,
  ) {
    this.assertOwnerOrAdmin(actor, businessId);
    const result = await this.database.transaction(async (client) => {
      const updated = await client.query<V2AccountRow>(
        `WITH changed AS (
           UPDATE settlement_accounts
           SET status = 'INACTIVE', last_activity_at = now()
           WHERE id = $1 AND business_id = $2 AND branch_id = $3
             AND scope_type = 'BRANCH' AND status = 'ACTIVE'
           RETURNING *
         )
         SELECT changed.*, bank.official_name, bank.short_name
         FROM changed JOIN supported_banks bank ON bank.id = changed.bank_id`,
        [accountId, businessId, branchId],
      );
      if (!updated.rows[0]) {
        throw new NotFoundException('Active settlement account not found');
      }
      await this.audit.recordWithClient(client, {
        actor: this.auditContext(actor),
        sessionId: actor.sessionId,
        actionType: 'SETTLEMENT_ACCOUNT_DEACTIVATED',
        recordType: 'SETTLEMENT_ACCOUNT',
        recordId: accountId,
        businessId,
        branchId,
        previousValue: { status: 'ACTIVE' },
        newValue: { status: 'INACTIVE' },
      });
      return updated.rows[0];
    });
    return { id: result.id, active: false, status: result.status };
  }

  async createPlatformAccount(
    input: CreatePlatformAccountDto,
    actor: AuthenticatedPrincipal,
  ) {
    this.assertPlatformAdmin(actor);
    this.rejectUnsupportedPlatformFields(input);
    const encrypted = this.crypto.encrypt(input.accountValue);
    const accountName = this.accountName(input);
    try {
      const row = await this.database.transaction(async (client) => {
        const result = await client.query<V2AccountRow>(
          `WITH inserted AS (
             INSERT INTO platform_settlement_accounts (
               bank_id, account_name, account_number_encrypted,
               account_number_hash, masked_account_number, normalized_account_suffix,
               opening_balance, calculated_balance
             )
             SELECT bank.id, $2, $3, $4, $5, $6, $7, $7
             FROM supported_banks bank
             WHERE bank.id = $1 AND bank.status = 'ACTIVE'
             RETURNING *
           )
           SELECT inserted.*, bank.official_name, bank.short_name
           FROM inserted
           JOIN supported_banks bank ON bank.id = inserted.bank_id`,
          [
            input.bankId,
            accountName,
            this.envelope(encrypted),
            encrypted.fingerprint,
            encrypted.mask,
            encrypted.suffix,
            input.openingBalance ?? 0,
          ],
        );
        if (!result.rows[0]) throw new NotFoundException('Active bank not found');
        await this.audit.recordWithClient(client, {
          actor: this.auditContext(actor),
          sessionId: actor.sessionId,
          actionType: 'PLATFORM_SETTLEMENT_ACCOUNT_CREATED',
          recordType: 'PLATFORM_SETTLEMENT_ACCOUNT',
          recordId: result.rows[0].id,
          newValue: { bankId: input.bankId, accountMask: encrypted.mask },
        });
        return result.rows[0];
      });
      return this.presentAccount(row);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException(
          'The account number or active platform bank account already exists',
        );
      }
      throw error;
    }
  }

  async listPlatformAccounts(actor: AuthenticatedPrincipal) {
    this.assertPlatformAdmin(actor);
    const result = await this.database.query<V2AccountRow>(
      `${this.accountSelect('platform_settlement_accounts')}
       ORDER BY account.created_at DESC`,
    );
    return result.rows.map((row) => this.presentAccount(row));
  }

  async updatePlatformAccount(
    accountId: string,
    input: UpdatePlatformAccountDto,
    actor: AuthenticatedPrincipal,
  ) {
    this.assertPlatformAdmin(actor);
    if (input.isDefault !== undefined || input.acceptedPlanCodes !== undefined) {
      throw new BadRequestException(
        'V2 platform accounts do not support defaults or accepted plan codes',
      );
    }
    if (input.active === undefined) {
      throw new BadRequestException('active is required for a V2 account update');
    }
    const row = await this.database.transaction(async (client) => {
      const result = await client.query<V2AccountRow>(
        `WITH changed AS (
           UPDATE platform_settlement_accounts
           SET status = $2::varchar
           WHERE id = $1
           RETURNING *
         )
         SELECT changed.*, bank.official_name, bank.short_name
         FROM changed JOIN supported_banks bank ON bank.id = changed.bank_id`,
        [accountId, input.active ? 'ACTIVE' : 'INACTIVE'],
      );
      if (!result.rows[0]) {
        throw new NotFoundException('Platform settlement account not found');
      }
      await this.audit.recordWithClient(client, {
        actor: this.auditContext(actor),
        sessionId: actor.sessionId,
        actionType: 'PLATFORM_SETTLEMENT_ACCOUNT_UPDATED',
        recordType: 'PLATFORM_SETTLEMENT_ACCOUNT',
        recordId: accountId,
        newValue: { status: result.rows[0].status },
      });
      return result.rows[0];
    });
    return this.presentAccount(row);
  }

  private requireOwnerContext(
    actor: AuthenticatedPrincipal,
    businessId: string,
  ): V2SelectedAuthContext & { membershipId: string; membershipRoleId: string } {
    if (
      actor.identityType !== 'BUSINESS_USER' ||
      (actor.role !== 'PRIMARY_OWNER' && actor.role !== 'ADDITIONAL_OWNER') ||
      !actor.businessIds.includes(businessId) ||
      !actor.membershipId ||
      !actor.membershipRoleId
    ) {
      throw new ForbiddenException('Active Business Owner context required');
    }
    return {
      ...this.auditContext(actor),
      membershipId: actor.membershipId,
      membershipRoleId: actor.membershipRoleId,
    };
  }

  private async requireOwnerAndBranch(
    client: PoolClient,
    businessId: string,
    branchId: string,
    context: V2SelectedAuthContext & {
      membershipId: string;
      membershipRoleId: string;
    },
    userId: string,
  ): Promise<void> {
    const result = await client.query(
      `SELECT 1
       FROM businesses business
       JOIN branches branch ON branch.business_id = business.id
       JOIN business_user_memberships membership
         ON membership.business_id = business.id
       JOIN membership_role_assignments role_assignment
         ON role_assignment.membership_id = membership.id
       WHERE business.id = $1 AND business.status = 'ACTIVE'
         AND branch.id = $2
         AND branch.status IN ('SETUP_REQUIRED','READY','ACTIVE')
         AND membership.id = $3 AND membership.user_id = $5
         AND membership.status = 'ACTIVE'
         AND role_assignment.id = $4 AND role_assignment.status = 'ACTIVE'
         AND role_assignment.role_code IN ('PRIMARY_OWNER','ADDITIONAL_OWNER')
       FOR UPDATE OF branch`,
      [businessId, branchId, context.membershipId, context.membershipRoleId, userId],
    );
    if (!result.rowCount) {
      throw new NotFoundException('Assignable branch and Owner context not found');
    }
  }

  private assertOwnerOrAdmin(
    actor: AuthenticatedPrincipal,
    businessId: string,
  ): void {
    if (actor.identityType === 'PLATFORM_ADMIN') return;
    if (
      (actor.role !== 'PRIMARY_OWNER' && actor.role !== 'ADDITIONAL_OWNER') ||
      !actor.businessIds.includes(businessId)
    ) {
      throw new ForbiddenException('Business Owner access required');
    }
  }

  private assertPlatformAdmin(actor: AuthenticatedPrincipal): void {
    if (
      actor.identityType !== 'PLATFORM_ADMIN' ||
      actor.role !== 'PLATFORM_SUPER_ADMIN'
    ) {
      throw new ForbiddenException('Platform administrator access required');
    }
  }

  private rejectUnsupportedPlatformFields(input: CreatePlatformAccountDto): void {
    if (input.isDefault !== undefined || input.acceptedPlanCodes !== undefined) {
      throw new BadRequestException(
        'V2 platform accounts do not support defaults or accepted plan codes',
      );
    }
  }

  private accountName(input: CreateSettlementAccountDto): string {
    const value = (input.accountName ?? input.label)?.trim();
    if (!value) {
      throw new BadRequestException('accountName is required in V2 schema mode');
    }
    return value;
  }

  private envelope(value: EncryptedAccountValue): Buffer {
    return Buffer.from(
      JSON.stringify({
        version: 1,
        algorithm: 'A256GCM',
        ciphertext: value.ciphertext,
        iv: value.iv,
        authTag: value.authTag,
      }),
      'utf8',
    );
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private accountSelect(
    table: 'settlement_accounts' | 'platform_settlement_accounts',
  ): string {
    return `SELECT account.*, bank.official_name, bank.short_name
            FROM ${table} account
            JOIN supported_banks bank ON bank.id = account.bank_id`;
  }

  private auditContext(actor: AuthenticatedPrincipal): V2SelectedAuthContext {
    return {
      identityType: actor.identityType ?? 'BUSINESS_USER',
      subjectId: actor.userId,
      role: actor.role as V2SelectedAuthContext['role'],
      businessId: actor.businessIds[0],
      membershipId: actor.membershipId,
      membershipRoleId: actor.membershipRoleId,
      workAssignmentId: actor.workAssignmentId,
      branchId: actor.branchId,
    };
  }

  private presentBank(row: V2BankRow) {
    return {
      id: row.id,
      code: row.verifyet_bank_identifier,
      name: row.official_name,
      shortName: row.short_name,
      accountType: row.account_type,
      accountNumberPattern: row.account_number_pattern,
      verificationMethod: row.verification_method,
      accountSuffixLength: row.account_suffix_length,
      phoneNumberFormat: row.phone_number_format,
      enabled: row.status === 'ACTIVE',
      status: row.status,
      createdAt: row.created_at,
    };
  }

  private presentAccount(row: V2AccountRow) {
    return {
      id: row.id,
      ...(row.business_id
        ? {
            businessId: row.business_id,
            scopeType: row.scope_type,
            branchId: row.branch_id,
          }
        : {}),
      bank: {
        id: row.bank_id,
        name: row.official_name,
        shortName: row.short_name,
      },
      accountName: row.account_name,
      accountMask: row.masked_account_number,
      accountSuffix: row.normalized_account_suffix,
      openingBalance: row.opening_balance,
      openingBalanceDate: row.opening_balance_date,
      calculatedBalance: row.calculated_balance,
      currency: row.currency ?? 'ETB',
      status: row.status,
      active: row.status === 'ACTIVE',
      version: row.version_no,
      createdAt: row.created_at,
    };
  }
}
