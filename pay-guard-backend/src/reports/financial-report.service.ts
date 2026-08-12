import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { FinancialSummaryQueryDto } from './dto/financial-report.dto';
import { FinancialReportDao, FinancialReportScope } from './financial-report.dao';

const MAX_REPORT_DAYS = 366;
const FINANCIAL_REPORT_ROLES = [
  'BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER', 'MANAGER', 'CASHIER',
];

@Injectable()
export class FinancialReportService {
  constructor(private readonly reports: FinancialReportDao) {}

  summary(
    businessId: string,
    input: FinancialSummaryQueryDto,
    actor: AuthenticatedPrincipal,
  ) {
    const scope = this.scope(businessId, actor);
    this.assertFilters(scope, input);
    return this.reports.summary(scope, input);
  }

  private scope(
    businessId: string,
    actor: AuthenticatedPrincipal,
  ): FinancialReportScope {
    if (
      actor.identityType === 'PLATFORM_ADMIN' ||
      !actor.businessIds.includes(businessId) ||
      !FINANCIAL_REPORT_ROLES.includes(actor.role)
    ) {
      throw new ForbiddenException('Financial report access required');
    }
    if (['MANAGER', 'CASHIER'].includes(actor.role) && !actor.branchId) {
      throw new ForbiddenException('Branch scope required');
    }
    return { businessId, branchId: actor.branchId };
  }

  private assertFilters(
    scope: FinancialReportScope,
    input: FinancialSummaryQueryDto,
  ): void {
    const from = this.utcDate(input.dateFrom);
    const to = this.utcDate(input.dateTo);
    if (from > to) {
      throw new BadRequestException('dateFrom must not be after dateTo');
    }
    const inclusiveDays = Math.floor((to - from) / 86_400_000) + 1;
    if (inclusiveDays > MAX_REPORT_DAYS) {
      throw new BadRequestException('Financial report range cannot exceed 366 days');
    }
    if (scope.branchId && input.branchId && scope.branchId !== input.branchId) {
      throw new ForbiddenException('Selected branch scope cannot be overridden');
    }
  }

  private utcDate(value: string): number {
    return Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`);
  }
}
