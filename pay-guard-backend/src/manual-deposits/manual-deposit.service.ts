import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CentralDao } from '../database/central.dao';
import { CreateManualDepositDto, ListManualDepositsDto } from './dto/manual-deposit.dto';
import {
  ManualDepositBalanceConflictError,
  ManualDepositDao,
  ManualDepositNotFoundError,
  ManualDepositReplayConflictError,
  ManualDepositScopeError,
} from './manual-deposit.dao';

@Injectable()
export class ManualDepositService {
  constructor(
    private readonly centralDao: CentralDao,
    private readonly deposits: ManualDepositDao,
  ) {}

  async create(
    businessId: string,
    branchId: string,
    input: CreateManualDepositDto,
    actor: AuthenticatedPrincipal,
  ) {
    this.assertCashier(businessId, branchId, actor);
    const actualTransactionAt = new Date(input.actualTransactionAt);
    if (actualTransactionAt.getTime() > Date.now()) {
      throw new BadRequestException('Future transaction dates are not permitted');
    }
    const description = input.description.trim();
    if (description.length < 3 || Number(input.amount) <= 0) {
      throw new BadRequestException('Manual deposit input is invalid');
    }
    try {
      const result = await this.centralDao.transaction((transaction) =>
        this.deposits.createWithin(transaction, {
          id: input.idempotencyKey,
          businessId,
          branchId,
          settlementAccountId: input.settlementAccountId,
          amount: input.amount,
          description,
          actualTransactionAt,
          expectedCurrentBalance: input.expectedCurrentBalance,
          expectedProjectedBalance: input.expectedProjectedBalance,
          actor,
        }),
      );
      return {
        deposit: result.deposit.toPublicModel(),
        replayed: result.replayed,
      };
    } catch (error) {
      if (error instanceof ManualDepositBalanceConflictError) {
        throw new ConflictException(
          'Settlement balance changed; refresh the projection and confirm again',
        );
      }
      if (error instanceof ManualDepositReplayConflictError) {
        throw new ConflictException('Manual deposit idempotency conflict');
      }
      if (error instanceof ManualDepositScopeError) {
        throw new ForbiddenException('Active Cashier settlement scope required');
      }
      if (error instanceof ManualDepositNotFoundError) {
        throw new NotFoundException('Manual deposit not found');
      }
      throw error;
    }
  }

  list(
    businessId: string,
    branchId: string,
    input: ListManualDepositsDto,
    actor: AuthenticatedPrincipal,
  ) {
    const scope = this.scope(businessId, branchId, actor);
    if (input.dateFrom && input.dateTo && input.dateFrom > input.dateTo) {
      throw new BadRequestException('dateFrom must not be after dateTo');
    }
    return this.deposits.list(scope, input);
  }

  async require(
    businessId: string,
    branchId: string,
    depositId: string,
    actor: AuthenticatedPrincipal,
  ) {
    const found = await this.deposits.find(
      depositId,
      this.scope(businessId, branchId, actor),
    );
    if (!found) throw new NotFoundException('Manual deposit not found');
    return found.toPublicModel();
  }

  private assertCashier(
    businessId: string,
    branchId: string,
    actor: AuthenticatedPrincipal,
  ): void {
    if (
      actor.identityType !== 'BUSINESS_USER' || actor.role !== 'CASHIER' ||
      !actor.businessIds.includes(businessId) || actor.branchId !== branchId ||
      !actor.membershipId || !actor.membershipRoleId || !actor.workAssignmentId
    ) {
      throw new ForbiddenException('Active Cashier branch context required');
    }
  }

  private scope(
    businessId: string,
    branchId: string,
    actor: AuthenticatedPrincipal,
  ) {
    if (
      actor.identityType === 'PLATFORM_ADMIN' ||
      !actor.businessIds.includes(businessId) ||
      !['BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER', 'MANAGER', 'CASHIER']
        .includes(actor.role) ||
      (['MANAGER', 'CASHIER'].includes(actor.role) && actor.branchId !== branchId)
    ) {
      throw new ForbiddenException('Manual deposit access denied');
    }
    return { businessId, branchId };
  }
}
