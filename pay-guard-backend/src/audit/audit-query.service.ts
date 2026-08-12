import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { AuditQueryDao } from './audit-query.dao';
import { AuditQueryDto } from './dto/audit-query.dto';

const BUSINESS_AUDIT_ROLES = [
  'BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER', 'MANAGER',
];
const MAX_AUDIT_RANGE_MS = 366 * 86_400_000;

@Injectable()
export class AuditQueryService {
  constructor(private readonly queries: AuditQueryDao) {}

  business(businessId: string, input: AuditQueryDto, actor: AuthenticatedPrincipal) {
    if (
      actor.identityType === 'PLATFORM_ADMIN' ||
      !actor.businessIds.includes(businessId) ||
      !BUSINESS_AUDIT_ROLES.includes(actor.role)
    ) {
      throw new ForbiddenException('Business audit access required');
    }
    if (input.businessId && input.businessId !== businessId) {
      throw new ForbiddenException('Business audit scope cannot be overridden');
    }
    if (actor.role === 'MANAGER' && !actor.branchId) {
      throw new ForbiddenException('Branch scope required');
    }
    if (actor.branchId && input.branchId && input.branchId !== actor.branchId) {
      throw new ForbiddenException('Selected branch scope cannot be overridden');
    }
    this.assertDateRange(input);
    return this.queries.list({
      platform: false,
      businessId,
      branchId: actor.branchId,
    }, input);
  }

  platform(input: AuditQueryDto, actor: AuthenticatedPrincipal) {
    if (actor.identityType !== 'PLATFORM_ADMIN' || actor.role !== 'PLATFORM_SUPER_ADMIN') {
      throw new ForbiddenException('Platform audit access required');
    }
    this.assertDateRange(input);
    return this.queries.list({ platform: true }, input);
  }

  private assertDateRange(input: AuditQueryDto): void {
    if (!input.dateFrom || !input.dateTo) return;
    const from = Date.parse(input.dateFrom);
    const to = Date.parse(input.dateTo);
    if (from > to) throw new BadRequestException('dateFrom must not be after dateTo');
    if (to - from > MAX_AUDIT_RANGE_MS) {
      throw new BadRequestException('Audit query range cannot exceed 366 days');
    }
  }
}
