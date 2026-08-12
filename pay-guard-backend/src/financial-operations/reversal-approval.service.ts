import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CentralDao } from '../database/central.dao';
import { ApproveReversalDto } from './dto/financial-operation.dto';
import {
  ReversalAlreadyApprovedError,
  ReversalApprovalDao,
  ReversalBalanceConflictError,
  ReversalInsufficientBalanceError,
  ReversalNotFoundError,
  ReversalReplayConflictError,
  reversalPublicModel,
} from './reversal-approval.dao';

@Injectable()
export class ReversalApprovalService {
  constructor(
    private readonly centralDao: CentralDao,
    private readonly approvals: ReversalApprovalDao,
  ) {}

  async approve(
    businessId: string,
    branchId: string,
    originalLedgerEntryId: string,
    input: ApproveReversalDto,
    actor: AuthenticatedPrincipal,
  ) {
    this.assertManager(businessId, branchId, actor);
    const actualTransactionAt = new Date(input.actualTransactionAt);
    if (actualTransactionAt.getTime() > Date.now()) {
      throw new BadRequestException('Future transaction dates are not permitted');
    }
    const reason = input.reason.trim();
    if (reason.length < 10) {
      throw new BadRequestException('A meaningful reversal reason is required');
    }
    try {
      const result = await this.centralDao.transaction((transaction) =>
        this.approvals.approveWithin(transaction, {
          id: input.idempotencyKey, businessId, branchId,
          originalLedgerEntryId, reason, actualTransactionAt,
          expectedCurrentBalance: input.expectedCurrentBalance,
          expectedProjectedBalance: input.expectedProjectedBalance,
          actor,
        }),
      );
      return {
        approval: reversalPublicModel(result.approvalId, result.reversal),
        replayed: result.replayed,
      };
    } catch (error) {
      if (error instanceof ReversalNotFoundError) {
        throw new NotFoundException('Reversible ledger entry not found');
      }
      if (error instanceof ReversalAlreadyApprovedError) {
        throw new ConflictException('Ledger entry already has a reversal');
      }
      if (error instanceof ReversalBalanceConflictError) {
        throw new ConflictException(
          'Settlement balance changed; refresh the projection and confirm again',
        );
      }
      if (error instanceof ReversalInsufficientBalanceError) {
        throw new ConflictException('Reversal would overdraw the settlement account');
      }
      if (error instanceof ReversalReplayConflictError) {
        throw new ConflictException('Reversal approval idempotency conflict');
      }
      throw error;
    }
  }

  private assertManager(
    businessId: string,
    branchId: string,
    actor: AuthenticatedPrincipal,
  ): void {
    if (
      actor.identityType !== 'BUSINESS_USER' || actor.role !== 'MANAGER' ||
      !actor.businessIds.includes(businessId) || actor.branchId !== branchId ||
      !actor.membershipId || !actor.membershipRoleId || !actor.workAssignmentId
    ) {
      throw new ForbiddenException('Active Manager branch context required');
    }
  }
}
