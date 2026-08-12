import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { ListTransactionsDto } from './dto/list-transactions.dto';
import { ReceiptReviewSummaryDto } from './dto/receipt-review-summary.dto';
import {
  TransactionQueryDao,
  TransactionQueryScope,
} from './transaction-query.dao';

@Injectable()
export class TransactionQueryService {
  constructor(private readonly transactions: TransactionQueryDao) {}

  async list(
    businessId: string,
    input: ListTransactionsDto,
    actor: AuthenticatedPrincipal,
  ) {
    const scope = this.scope(businessId, actor);
    if (input.dateFrom && input.dateTo && input.dateFrom > input.dateTo) {
      throw new BadRequestException('dateFrom must not be after dateTo');
    }
    if (scope.branchId && input.branchId && scope.branchId !== input.branchId) {
      throw new ForbiddenException('Selected branch scope cannot be overridden');
    }
    return this.transactions.list(scope, input);
  }

  async require(
    businessId: string,
    transactionId: string,
    actor: AuthenticatedPrincipal,
  ) {
    const found = await this.transactions.find(
      transactionId,
      this.scope(businessId, actor),
    );
    if (!found) throw new NotFoundException('Transaction not found');
    return found;
  }

  async history(
    businessId: string,
    transactionId: string,
    actor: AuthenticatedPrincipal,
  ) {
    const found = await this.transactions.history(
      transactionId,
      this.scope(businessId, actor),
    );
    if (!found) throw new NotFoundException('Transaction not found');
    return found;
  }

  async verificationOutcomes(
    businessId: string,
    transactionId: string,
    actor: AuthenticatedPrincipal,
  ) {
    const found = await this.transactions.verificationOutcomes(
      transactionId,
      this.scope(businessId, actor),
    );
    if (!found) throw new NotFoundException('Transaction not found');
    return found;
  }

  async receiptDecisions(
    businessId: string,
    transactionId: string,
    actor: AuthenticatedPrincipal,
  ) {
    const found = await this.transactions.receiptDecisions(
      transactionId,
      this.scope(businessId, actor),
    );
    if (!found) throw new NotFoundException('Transaction not found');
    return found;
  }

  async receiptReviewSummary(
    businessId: string,
    input: ReceiptReviewSummaryDto,
    actor: AuthenticatedPrincipal,
  ) {
    const scope = this.scope(businessId, actor);
    this.assertFilters(scope, input);
    return this.transactions.receiptReviewSummary(scope, input);
  }

  private assertFilters(
    scope: TransactionQueryScope,
    input: { branchId?: string; dateFrom?: string; dateTo?: string },
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
  ): TransactionQueryScope {
    const platformAdmin =
      actor.identityType === 'PLATFORM_ADMIN' &&
      actor.role === 'PLATFORM_SUPER_ADMIN';
    if (!platformAdmin && !actor.businessIds.includes(businessId)) {
      throw new ForbiddenException('Business access required');
    }
    if (actor.role === 'PLATFORM_SUPER_ADMIN' && !platformAdmin) {
      throw new ForbiddenException('Platform administrator access required');
    }
    return {
      businessId,
      branchId: actor.branchId,
      submittedByUserId: actor.role === 'WAITER' ? actor.userId : undefined,
    };
  }
}
