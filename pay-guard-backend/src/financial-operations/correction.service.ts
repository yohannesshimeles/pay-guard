import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CentralDao } from '../database/central.dao';
import {
  CorrectionBalanceConflictError,
  CorrectionDao,
  CorrectionEvidenceError,
  CorrectionInsufficientBalanceError,
  CorrectionNotFoundError,
  CorrectionReplayConflictError,
  CorrectionScopeError,
} from './correction.dao';
import { CreateCorrectionDto, ListCorrectionsDto } from './dto/financial-operation.dto';

@Injectable()
export class CorrectionService {
  constructor(
    private readonly centralDao: CentralDao,
    private readonly corrections: CorrectionDao,
  ) {}

  async create(
    businessId: string,
    branchId: string,
    input: CreateCorrectionDto,
    actor: AuthenticatedPrincipal,
  ) {
    this.assertManager(businessId, branchId, actor);
    const actualTransactionAt = new Date(input.actualTransactionAt);
    if (actualTransactionAt.getTime() > Date.now()) {
      throw new BadRequestException('Future transaction dates are not permitted');
    }
    const reason = input.reason.trim();
    if (Number(input.amount) <= 0 || reason.length < 10) {
      throw new BadRequestException('Correction input is invalid');
    }
    try {
      const result = await this.centralDao.transaction((transaction) =>
        this.corrections.createWithin(transaction, {
          id: input.idempotencyKey, businessId, branchId,
          settlementAccountId: input.settlementAccountId,
          correctionType: input.correctionType, amount: input.amount, reason,
          actualTransactionAt,
          sourceReconciliationId: input.sourceReconciliationId,
          expectedCurrentBalance: input.expectedCurrentBalance,
          expectedProjectedBalance: input.expectedProjectedBalance,
          actor,
        }),
      );
      return {
        correction: result.correction.toPublicModel(),
        replayed: result.replayed,
      };
    } catch (error) {
      if (error instanceof CorrectionEvidenceError) {
        throw new BadRequestException('Reconciliation evidence is not valid for this account');
      }
      if (error instanceof CorrectionBalanceConflictError) {
        throw new ConflictException(
          'Settlement balance changed; refresh the projection and confirm again',
        );
      }
      if (error instanceof CorrectionInsufficientBalanceError) {
        throw new ConflictException('Negative correction would overdraw the account');
      }
      if (error instanceof CorrectionReplayConflictError) {
        throw new ConflictException('Correction idempotency conflict');
      }
      if (error instanceof CorrectionScopeError) {
        throw new ForbiddenException('Active Manager settlement scope required');
      }
      if (error instanceof CorrectionNotFoundError) {
        throw new NotFoundException('Correction not found');
      }
      throw error;
    }
  }

  list(
    businessId: string,
    branchId: string,
    input: ListCorrectionsDto,
    actor: AuthenticatedPrincipal,
  ) {
    const scope = this.scope(businessId, branchId, actor);
    if (input.dateFrom && input.dateTo && input.dateFrom > input.dateTo) {
      throw new BadRequestException('dateFrom must not be after dateTo');
    }
    return this.corrections.list(scope, input);
  }

  async require(
    businessId: string,
    branchId: string,
    correctionId: string,
    actor: AuthenticatedPrincipal,
  ) {
    const found = await this.corrections.find(
      correctionId,
      this.scope(businessId, branchId, actor),
    );
    if (!found) throw new NotFoundException('Correction not found');
    return found.toPublicModel();
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

  private scope(
    businessId: string,
    branchId: string,
    actor: AuthenticatedPrincipal,
  ) {
    if (
      actor.identityType === 'PLATFORM_ADMIN' ||
      !actor.businessIds.includes(businessId) ||
      !['BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER', 'MANAGER']
        .includes(actor.role) ||
      (actor.role === 'MANAGER' && actor.branchId !== branchId)
    ) {
      throw new ForbiddenException('Correction access denied');
    }
    return { businessId, branchId };
  }
}
