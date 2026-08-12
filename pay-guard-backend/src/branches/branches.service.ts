import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { DatabaseService } from '../database/database.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

type BranchRow = {
  id: string;
  business_id: string;
  name: string;
  code: string | null;
  address: string | null;
  status: string;
  timezone: string;
  currency_code: string;
  verification_time_tolerance_minutes: number;
  created_at: Date;
};

@Injectable()
export class BranchesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async create(
    businessId: string,
    input: CreateBranchDto,
    actor: AuthenticatedPrincipal,
  ) {
    this.assertBusinessAccess(actor, businessId);
    try {
      const row = await this.database.transaction(async (client) => {
        const business = await client.query(
          `SELECT 1 FROM businesses
           WHERE id = $1 AND status = 'ACTIVE'`,
          [businessId],
        );
        if (!business.rowCount) {
          throw new NotFoundException('Active business not found');
        }
        const branch = await client.query<{ id: string }>(
          `INSERT INTO branches (business_id, name, code, address)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [businessId, input.name, input.code ?? null, input.address ?? null],
        );
        await client.query(
          `INSERT INTO branch_settings (branch_id, timezone)
           VALUES ($1, $2)`,
          [branch.rows[0].id, input.timezone ?? 'Africa/Addis_Ababa'],
        );
        return this.findRow(client, businessId, branch.rows[0].id);
      });
      await this.audit.record({
        actorUserId: actor.userId,
        businessId,
        branchId: row.id,
        action: 'branch.created',
        targetType: 'branch',
        targetId: row.id,
      });
      return this.present(row);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('Branch name already exists for this business');
      }
      throw error;
    }
  }

  async list(businessId: string, actor: AuthenticatedPrincipal) {
    this.assertBusinessAccess(actor, businessId);
    const result = await this.database.query<BranchRow>(
      `SELECT b.id, b.business_id, b.name, b.code, b.address, b.status,
              s.timezone, s.currency_code,
              s.verification_time_tolerance_minutes, b.created_at
       FROM branches b
       JOIN branch_settings s ON s.branch_id = b.id
       WHERE b.business_id = $1
         AND ($2::uuid IS NULL OR b.id = $2)
       ORDER BY b.created_at`,
      [businessId, actor.role === 'BUSINESS_OWNER' || actor.role === 'PLATFORM_SUPER_ADMIN'
        ? null
        : actor.branchId ?? null],
    );
    return result.rows.map((row) => this.present(row));
  }

  async update(
    businessId: string,
    branchId: string,
    input: UpdateBranchDto,
    actor: AuthenticatedPrincipal,
  ) {
    this.assertBusinessAccess(actor, businessId);
    const row = await this.database.transaction(async (client) => {
      const current = await this.findRow(client, businessId, branchId);
      await client.query(
        `UPDATE branches
         SET name = COALESCE($3, name),
             address = COALESCE($4, address),
             updated_at = now()
         WHERE id = $1 AND business_id = $2`,
        [branchId, businessId, input.name ?? null, input.address ?? null],
      );
      if (input.verificationTimeToleranceMinutes !== undefined) {
        await client.query(
          `UPDATE branch_settings
           SET verification_time_tolerance_minutes = $2, updated_at = now()
           WHERE branch_id = $1`,
          [branchId, input.verificationTimeToleranceMinutes],
        );
      }
      return this.findRow(client, businessId, current.id);
    });
    await this.audit.record({
      actorUserId: actor.userId,
      businessId,
      branchId,
      action: 'branch.updated',
      targetType: 'branch',
      targetId: branchId,
    });
    return this.present(row);
  }

  private assertBusinessAccess(actor: AuthenticatedPrincipal, businessId: string) {
    if (
      actor.role !== 'PLATFORM_SUPER_ADMIN' &&
      !actor.businessIds.includes(businessId)
    ) {
      throw new ForbiddenException('Business access denied');
    }
  }

  private async findRow(
    client: { query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }> },
    businessId: string,
    branchId: string,
  ): Promise<BranchRow> {
    const result = await client.query<BranchRow>(
      `SELECT b.id, b.business_id, b.name, b.code, b.address, b.status,
              s.timezone, s.currency_code,
              s.verification_time_tolerance_minutes, b.created_at
       FROM branches b
       JOIN branch_settings s ON s.branch_id = b.id
       WHERE b.id = $2 AND b.business_id = $1`,
      [businessId, branchId],
    );
    if (!result.rows[0]) throw new NotFoundException('Branch not found');
    return result.rows[0];
  }

  private present(row: BranchRow) {
    return {
      id: row.id,
      businessId: row.business_id,
      name: row.name,
      code: row.code,
      address: row.address,
      status: row.status,
      settings: {
        timezone: row.timezone,
        currencyCode: row.currency_code,
        verificationTimeToleranceMinutes:
          row.verification_time_tolerance_minutes,
      },
      createdAt: row.created_at,
    };
  }
}
