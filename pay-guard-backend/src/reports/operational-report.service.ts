import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import {
  OperationalSummaryQueryDto, ProviderSummaryQueryDto,
} from './dto/financial-report.dto';
import { FinancialReportScope } from './financial-report.dao';
import { OperationalReportDao } from './operational-report.dao';

const BUSINESS_REPORT_ROLES = [
  'BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER', 'MANAGER', 'CASHIER',
];

@Injectable()
export class OperationalReportService {
  constructor(private readonly reports: OperationalReportDao) {}

  businessSummary(
    businessId: string,
    input: OperationalSummaryQueryDto,
    actor: AuthenticatedPrincipal,
  ) {
    const scope = this.businessScope(businessId, actor);
    this.assertDateRange(input, 366);
    if (scope.branchId && input.branchId && scope.branchId !== input.branchId) {
      throw new ForbiddenException('Selected branch scope cannot be overridden');
    }
    return this.reports.businessSummary(scope, input);
  }

  providerSummary(
    input: ProviderSummaryQueryDto,
    actor: AuthenticatedPrincipal,
  ) {
    if (
      actor.identityType !== 'PLATFORM_ADMIN' ||
      actor.role !== 'PLATFORM_SUPER_ADMIN'
    ) {
      throw new ForbiddenException('Platform provider report access required');
    }
    this.assertDateRange(input, 93);
    return this.reports.providerSummary(input);
  }

  private businessScope(
    businessId: string,
    actor: AuthenticatedPrincipal,
  ): FinancialReportScope {
    if (
      actor.identityType === 'PLATFORM_ADMIN' ||
      !actor.businessIds.includes(businessId) ||
      !BUSINESS_REPORT_ROLES.includes(actor.role)
    ) {
      throw new ForbiddenException('Business operational report access required');
    }
    if (['MANAGER', 'CASHIER'].includes(actor.role) && !actor.branchId) {
      throw new ForbiddenException('Branch scope required');
    }
    return { businessId, branchId: actor.branchId };
  }

  private assertDateRange(
    input: { dateFrom: string; dateTo: string },
    maxDays: number,
  ): void {
    const from = Date.parse(`${input.dateFrom.slice(0, 10)}T00:00:00.000Z`);
    const to = Date.parse(`${input.dateTo.slice(0, 10)}T00:00:00.000Z`);
    if (from > to) throw new BadRequestException('dateFrom must not be after dateTo');
    if (Math.floor((to - from) / 86_400_000) + 1 > maxDays) {
      throw new BadRequestException(`Report range cannot exceed ${maxDays} days`);
    }
  }
}
