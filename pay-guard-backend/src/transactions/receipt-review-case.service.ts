import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { V2AuditService } from '../audit/v2-audit.service';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { V2SelectedAuthContext } from '../auth/v2-auth.types';
import { CentralDao } from '../database/central.dao';
import {
  AcknowledgeReceiptReviewCaseDto,
  ListReceiptReviewCasesDto,
  ReceiptReviewAgeingSummaryDto,
  ResolveReceiptReviewCaseDto,
} from './dto/receipt-review-case.dto';
import {
  ReceiptReviewCaseConflictError,
  ReceiptReviewCaseDao,
  ReceiptReviewCaseNotFoundError,
} from './receipt-review-case.dao';
import { TransactionQueryScope } from './transaction-query.dao';

@Injectable()
export class ReceiptReviewCaseService {
  constructor(
    private readonly dao: CentralDao,
    private readonly cases: ReceiptReviewCaseDao,
    private readonly audit: V2AuditService,
  ) {}

  list(
    businessId: string,
    input: ListReceiptReviewCasesDto,
    actor: AuthenticatedPrincipal,
  ) {
    const scope = this.scope(businessId, actor);
    this.assertBranchFilter(scope, input.branchId);
    return this.cases.list(scope, input);
  }

  history(
    businessId: string,
    id: string,
    actor: AuthenticatedPrincipal,
  ) {
    return this.change(() =>
      this.cases.history(this.scope(businessId, actor), id),
    );
  }

  ageingSummary(
    businessId: string,
    input: ReceiptReviewAgeingSummaryDto,
    actor: AuthenticatedPrincipal,
  ) {
    const scope = this.scope(businessId, actor);
    this.assertBranchFilter(scope, input.branchId);
    return this.cases.ageingSummary(scope, input);
  }

  acknowledge(
    businessId: string,
    id: string,
    input: AcknowledgeReceiptReviewCaseDto,
    actor: AuthenticatedPrincipal,
  ) {
    return this.change(async () => {
      return this.dao.transaction(async (transaction) => {
        const reviewCase = await this.cases.acknowledgeWithin(transaction, {
          id, scope: this.scope(businessId, actor), actorId: actor.userId,
          note: input.note,
        });
        await this.audit.recordWithin(transaction, {
          actor: this.auditActor(actor, businessId), sessionId: actor.sessionId,
          actionType: 'RECEIPT_REVIEW_ACKNOWLEDGED',
          recordType: 'RECEIPT_REVIEW_CASE', recordId: reviewCase.id,
          businessId, branchId: reviewCase.branchId,
          previousValue: { status: 'OPEN' },
          newValue: { status: reviewCase.status }, reason: input.note,
        });
        return reviewCase;
      });
    });
  }

  resolve(
    businessId: string,
    id: string,
    input: ResolveReceiptReviewCaseDto,
    actor: AuthenticatedPrincipal,
  ) {
    if (input.resolutionCode === 'OTHER' && !input.note?.trim()) {
      throw new BadRequestException('A note is required for OTHER resolution');
    }
    return this.change(async () => {
      return this.dao.transaction(async (transaction) => {
        const reviewCase = await this.cases.resolveWithin(transaction, {
          id, scope: this.scope(businessId, actor), actorId: actor.userId,
          resolutionCode: input.resolutionCode, note: input.note,
        });
        await this.audit.recordWithin(transaction, {
          actor: this.auditActor(actor, businessId), sessionId: actor.sessionId,
          actionType: 'RECEIPT_REVIEW_RESOLVED',
          recordType: 'RECEIPT_REVIEW_CASE', recordId: reviewCase.id,
          businessId, branchId: reviewCase.branchId,
          previousValue: { status: 'ACKNOWLEDGED' },
          newValue: {
            status: reviewCase.status,
            resolutionCode: reviewCase.resolutionCode,
          },
          reason: input.note,
        });
        return reviewCase;
      });
    });
  }

  private async change<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ReceiptReviewCaseNotFoundError) {
        throw new NotFoundException('Receipt review case not found');
      }
      if (error instanceof ReceiptReviewCaseConflictError) {
        throw new ConflictException('Receipt review case lifecycle conflict');
      }
      throw error;
    }
  }

  private scope(
    businessId: string,
    actor: AuthenticatedPrincipal,
  ): TransactionQueryScope {
    if (
      actor.identityType === 'PLATFORM_ADMIN' ||
      !actor.businessIds.includes(businessId) ||
      !['BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER', 'MANAGER'].includes(
        actor.role,
      )
    ) {
      throw new ForbiddenException('Owner or Manager access required');
    }
    if (actor.role === 'MANAGER' && !actor.branchId) {
      throw new ForbiddenException('Manager branch scope required');
    }
    return { businessId, branchId: actor.branchId };
  }

  private assertBranchFilter(
    scope: TransactionQueryScope,
    branchId?: string,
  ): void {
    if (scope.branchId && branchId && scope.branchId !== branchId) {
      throw new ForbiddenException('Selected branch scope cannot be overridden');
    }
  }

  private auditActor(
    actor: AuthenticatedPrincipal,
    businessId: string,
  ): V2SelectedAuthContext {
    return {
      identityType: 'BUSINESS_USER', subjectId: actor.userId,
      role: actor.role === 'BUSINESS_OWNER' ? 'PRIMARY_OWNER' : actor.role,
      businessId, membershipId: actor.membershipId,
      membershipRoleId: actor.membershipRoleId,
      workAssignmentId: actor.workAssignmentId, branchId: actor.branchId,
    };
  }
}
