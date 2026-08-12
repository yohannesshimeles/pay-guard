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
  CreateReconciliationDto,
  DecideReconciliationDto,
  ListReconciliationsDto,
} from './dto/reconciliation.dto';
import {
  ReconciliationDao,
  ReconciliationExplanationRequiredError,
  ReconciliationNotFoundError,
  ReconciliationReplayConflictError,
  ReconciliationScheduleNotFoundError,
  ReconciliationTransitionError,
  ReconciliationDecisionConflictError,
} from './reconciliation.dao';

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly centralDao: CentralDao,
    private readonly reconciliations: ReconciliationDao,
  ) {}

  async create(
    businessId: string,
    branchId: string,
    input: CreateReconciliationDto,
    actor: AuthenticatedPrincipal,
  ) {
    this.assertCashier(businessId, branchId, actor);
    if (new Date(`${input.reconciliationDate}T00:00:00.000Z`).getTime() > Date.now()) {
      throw new BadRequestException('Future reconciliation dates are not permitted');
    }
    const description = input.description.trim();
    const differenceExplanation = input.differenceExplanation?.trim();
    try {
      const result = await this.centralDao.transaction((transaction) =>
        this.reconciliations.createWithin(transaction, {
          id: input.idempotencyKey, businessId, branchId,
          settlementAccountId: input.settlementAccountId,
          reconciliationDate: input.reconciliationDate,
          actualBankBalance: input.actualBankBalance,
          description, differenceExplanation, actor,
        }),
      );
      return {
        reconciliation: result.reconciliation.toPublicModel(),
        replayed: result.replayed,
      };
    } catch (error) {
      if (error instanceof ReconciliationScheduleNotFoundError) {
        throw new NotFoundException('Active branch reconciliation schedule not found');
      }
      if (error instanceof ReconciliationExplanationRequiredError) {
        throw new BadRequestException(
          'A difference explanation is required when balances do not match',
        );
      }
      if (error instanceof ReconciliationReplayConflictError) {
        throw new ConflictException('Reconciliation idempotency conflict');
      }
      throw error;
    }
  }

  async submit(
    businessId: string,
    branchId: string,
    reconciliationId: string,
    actor: AuthenticatedPrincipal,
  ) {
    this.assertCashier(businessId, branchId, actor);
    try {
      const result = await this.centralDao.transaction((transaction) =>
        this.reconciliations.submitWithin(transaction, {
          id: reconciliationId, businessId, branchId, actor,
        }),
      );
      return {
        reconciliation: result.reconciliation.toPublicModel(),
        replayed: result.replayed,
      };
    } catch (error) {
      if (error instanceof ReconciliationNotFoundError) {
        throw new NotFoundException('Reconciliation not found');
      }
      if (error instanceof ReconciliationTransitionError) {
        throw new ConflictException('Reconciliation cannot be submitted from its current state');
      }
      throw error;
    }
  }

  async decide(
    businessId: string,
    branchId: string,
    reconciliationId: string,
    input: DecideReconciliationDto,
    actor: AuthenticatedPrincipal,
  ) {
    this.assertManager(businessId, branchId, actor);
    const reason = input.reason.trim();
    if (reason.length < 10) {
      throw new BadRequestException('A meaningful reconciliation decision reason is required');
    }
    try {
      const result = await this.centralDao.transaction((transaction) =>
        this.reconciliations.decideWithin(transaction, {
          id: reconciliationId, businessId, branchId,
          decision: input.decision, reason, actor,
        }),
      );
      return {
        reconciliation: result.reconciliation.toPublicModel(),
        replayed: result.replayed,
      };
    } catch (error) {
      if (error instanceof ReconciliationNotFoundError) {
        throw new NotFoundException('Reconciliation not found');
      }
      if (
        error instanceof ReconciliationTransitionError ||
        error instanceof ReconciliationDecisionConflictError
      ) {
        throw new ConflictException('Reconciliation decision conflicts with its current state');
      }
      throw error;
    }
  }

  list(
    businessId: string,
    branchId: string,
    input: ListReconciliationsDto,
    actor: AuthenticatedPrincipal,
  ) {
    const scope = this.scope(businessId, branchId, actor);
    if (input.dateFrom && input.dateTo && input.dateFrom > input.dateTo) {
      throw new BadRequestException('dateFrom must not be after dateTo');
    }
    return this.reconciliations.list(scope, input);
  }

  async require(
    businessId: string,
    branchId: string,
    reconciliationId: string,
    actor: AuthenticatedPrincipal,
  ) {
    const scope = this.scope(businessId, branchId, actor);
    const found = await this.reconciliations.find(reconciliationId, scope);
    if (!found) throw new NotFoundException('Reconciliation not found');
    return {
      ...found.toPublicModel(),
      history: await this.reconciliations.history(reconciliationId, scope),
    };
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
      !['BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER', 'MANAGER', 'CASHIER']
        .includes(actor.role) ||
      (['MANAGER', 'CASHIER'].includes(actor.role) && actor.branchId !== branchId)
    ) {
      throw new ForbiddenException('Reconciliation access denied');
    }
    return { businessId, branchId };
  }
}
