import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { ListLedgerEntriesDto, ProjectedBalanceDto } from './dto/ledger-query.dto';
import { LedgerQueryDao, LedgerQueryScope } from './ledger-query.dao';

@Injectable()
export class LedgerQueryService {
  constructor(private readonly ledger: LedgerQueryDao) {}

  list(
    businessId: string,
    input: ListLedgerEntriesDto,
    actor: AuthenticatedPrincipal,
  ) {
    const scope = this.scope(businessId, actor);
    this.assertFilters(scope, input);
    return this.ledger.list(scope, input);
  }

  async require(
    businessId: string,
    entryId: string,
    actor: AuthenticatedPrincipal,
  ) {
    const found = await this.ledger.find(entryId, this.scope(businessId, actor));
    if (!found) throw new NotFoundException('Ledger entry not found');
    return found;
  }

  async projectedBalance(
    businessId: string,
    accountId: string,
    input: ProjectedBalanceDto,
    actor: AuthenticatedPrincipal,
  ) {
    const found = await this.ledger.projectedBalance(
      accountId, this.scope(businessId, actor), input,
    );
    if (!found) throw new NotFoundException('Settlement account not found');
    return found;
  }

  private assertFilters(
    scope: LedgerQueryScope,
    input: ListLedgerEntriesDto,
  ): void {
    if (input.dateFrom && input.dateTo && input.dateFrom > input.dateTo) {
      throw new BadRequestException('dateFrom must not be after dateTo');
    }
    if (scope.branchId && input.branchId && scope.branchId !== input.branchId) {
      throw new ForbiddenException('Selected branch scope cannot be overridden');
    }
  }

  private scope(
    businessId: string,
    actor: AuthenticatedPrincipal,
  ): LedgerQueryScope {
    if (
      actor.identityType === 'PLATFORM_ADMIN' ||
      !actor.businessIds.includes(businessId) ||
      !['BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER', 'MANAGER', 'CASHIER']
        .includes(actor.role)
    ) {
      throw new ForbiddenException('Financial ledger access required');
    }
    if (['MANAGER', 'CASHIER'].includes(actor.role) && !actor.branchId) {
      throw new ForbiddenException('Branch scope required');
    }
    return { businessId, branchId: actor.branchId };
  }
}
