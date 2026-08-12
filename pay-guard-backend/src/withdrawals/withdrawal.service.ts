import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CentralDao } from '../database/central.dao';
import { CreateWithdrawalDto, ListWithdrawalsDto } from './dto/withdrawal.dto';
import {
  WithdrawalBalanceConflictError,
  WithdrawalDao,
  WithdrawalInsufficientBalanceError,
  WithdrawalNotFoundError,
  WithdrawalReplayConflictError,
  WithdrawalScopeError,
} from './withdrawal.dao';

@Injectable()
export class WithdrawalService {
  constructor(
    private readonly centralDao: CentralDao,
    private readonly withdrawals: WithdrawalDao,
  ) {}

  async create(
    businessId: string,
    branchId: string,
    input: CreateWithdrawalDto,
    actor: AuthenticatedPrincipal,
  ) {
    this.assertCashier(businessId, branchId, actor);
    const actualTransactionAt = new Date(input.actualTransactionAt);
    if (actualTransactionAt.getTime() > Date.now()) {
      throw new BadRequestException('Future transaction dates are not permitted');
    }
    const recipientName = input.recipientName.trim();
    const recipientBankName = input.recipientBankName.trim();
    const description = input.description.trim();
    if (
      Number(input.amount) <= 0 || recipientName.length < 2 ||
      recipientBankName.length < 2 || description.length < 3
    ) {
      throw new BadRequestException('Withdrawal input is invalid');
    }
    try {
      const result = await this.centralDao.transaction((transaction) =>
        this.withdrawals.createWithin(transaction, {
          id: input.idempotencyKey, businessId, branchId,
          settlementAccountId: input.settlementAccountId,
          amount: input.amount, recipientName, recipientBankName, description,
          actualTransactionAt,
          expectedCurrentBalance: input.expectedCurrentBalance,
          expectedProjectedBalance: input.expectedProjectedBalance,
          actor,
        }),
      );
      return {
        withdrawal: result.withdrawal.toPublicModel(),
        replayed: result.replayed,
      };
    } catch (error) {
      if (error instanceof WithdrawalBalanceConflictError) {
        throw new ConflictException(
          'Settlement balance changed; refresh the projection and confirm again',
        );
      }
      if (error instanceof WithdrawalInsufficientBalanceError) {
        throw new ConflictException('Insufficient calculated settlement balance');
      }
      if (error instanceof WithdrawalReplayConflictError) {
        throw new ConflictException('Withdrawal idempotency conflict');
      }
      if (error instanceof WithdrawalScopeError) {
        throw new ForbiddenException('Active Cashier settlement scope required');
      }
      if (error instanceof WithdrawalNotFoundError) {
        throw new NotFoundException('Withdrawal not found');
      }
      throw error;
    }
  }

  list(
    businessId: string,
    branchId: string,
    input: ListWithdrawalsDto,
    actor: AuthenticatedPrincipal,
  ) {
    const scope = this.scope(businessId, branchId, actor);
    if (input.dateFrom && input.dateTo && input.dateFrom > input.dateTo) {
      throw new BadRequestException('dateFrom must not be after dateTo');
    }
    return this.withdrawals.list(scope, input);
  }

  async require(
    businessId: string,
    branchId: string,
    withdrawalId: string,
    actor: AuthenticatedPrincipal,
  ) {
    const found = await this.withdrawals.find(
      withdrawalId,
      this.scope(businessId, branchId, actor),
    );
    if (!found) throw new NotFoundException('Withdrawal not found');
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
      throw new ForbiddenException('Withdrawal access denied');
    }
    return { businessId, branchId };
  }
}
