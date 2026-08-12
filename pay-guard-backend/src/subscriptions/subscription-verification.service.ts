import {
  ConflictException, ForbiddenException, Inject, Injectable,
  NotFoundException, ServiceUnavailableException, UnprocessableEntityException,
} from '@nestjs/common';
import { V2AuditService } from '../audit/v2-audit.service';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { V2SelectedAuthContext } from '../auth/v2-auth.types';
import { deterministicUuid } from '../common/deterministic-uuid';
import { CentralDao } from '../database/central.dao';
import {
  VERIFYET_PROVIDER_ADAPTER, VerifyEtProviderAdapter,
} from '../verify-et/verify-et-provider.adapter';
import {
  SubscriptionProofMatchError, SubscriptionVerificationDao,
  SubscriptionVerificationOutcomeConflictError, SubscriptionVerificationScopeError,
} from './subscription-verification.dao';

@Injectable()
export class SubscriptionVerificationService {
  constructor(
    private readonly centralDao: CentralDao,
    private readonly verifications: SubscriptionVerificationDao,
    private readonly audit: V2AuditService,
    @Inject(VERIFYET_PROVIDER_ADAPTER) private readonly provider: VerifyEtProviderAdapter,
  ) {}

  async verify(businessId: string, branchId: string, orderId: string,
    actor: AuthenticatedPrincipal) {
    this.assertOwner(businessId, actor);
    const verificationId = deterministicUuid(`subscription-verification:${orderId}`);
    const prepared = await this.prepare({
      verificationId, businessId, branchId, orderId, actor,
    });
    const providerRequest = {
      idempotencyKey: `subscription:verify:${orderId}`,
      verificationAttemptId: verificationId,
      ...prepared.request,
    };
    let providerResult;
    try {
      providerResult = await this.provider.verify(providerRequest);
    } catch {
      throw new ServiceUnavailableException(
        'Subscription verification provider is temporarily unavailable',
      );
    }
    try {
      const outcome = await this.centralDao.transaction(async (transaction) => {
        const recorded = await this.verifications.recordOutcomeWithin(transaction, {
          verificationId, orderId, businessId, branchId,
          subscriptionId: deterministicUuid(`business-subscription:${orderId}`),
          invoiceId: deterministicUuid(`subscription-invoice:${orderId}`),
          creditLotId: deterministicUuid(`subscription-credit-lot:${orderId}`),
          creditGrantEventKey: `subscription-grant:${orderId}`,
          provider: providerResult,
        });
        if (!recorded.replayed) {
          await this.audit.recordWithin(transaction, {
            actor: this.auditActor(actor, businessId), sessionId: actor.sessionId,
            actionType: `SUBSCRIPTION_VERIFICATION_${recorded.decision}`,
            recordType: 'SUBSCRIPTION_ORDER', recordId: orderId,
            businessId, branchId,
            newValue: { decision: recorded.decision,
              providerRequestId: providerResult.providerRequestId,
              ...('duplicateClassification' in recorded
                ? { duplicateClassification: recorded.duplicateClassification } : {}),
              ...('fraudAttemptNumber' in recorded
                ? { fraudAttemptNumber: recorded.fraudAttemptNumber,
                  purchaseLocked: recorded.purchaseLocked } : {}) },
          });
        }
        return recorded;
      });
      return {
        verificationId, decision: outcome.decision, replayed: outcome.replayed,
        creditPreparation: prepared.credit,
        ...('grant' in outcome ? { grant: outcome.grant } : {}),
        ...('reason' in outcome ? { reason: outcome.reason } : {}),
        ...('duplicateClassification' in outcome
          ? { duplicateClassification: outcome.duplicateClassification } : {}),
        ...('fraudAttemptNumber' in outcome
          ? { fraudAttemptNumber: outcome.fraudAttemptNumber,
            purchaseLocked: outcome.purchaseLocked } : {}),
      };
    } catch (error) {
      if (error instanceof SubscriptionVerificationOutcomeConflictError) {
        throw new ConflictException('Subscription verification outcome conflict');
      }
      if (error instanceof SubscriptionVerificationScopeError) {
        throw new NotFoundException('Subscription verification not found');
      }
      throw error;
    }
  }

  private async prepare(input: {
    verificationId: string; businessId: string; branchId: string; orderId: string;
    actor: AuthenticatedPrincipal;
  }) {
    try {
      return await this.centralDao.transaction(async (transaction) => {
        const result = await this.verifications.prepareWithin(transaction, {
          id: input.verificationId,
          idempotencyKey: `subscription:verify:${input.orderId}`,
          deferredId: deterministicUuid(`subscription-deferred:${input.orderId}`),
          creditEventKey: `subscription-verification:${input.orderId}`,
          orderId: input.orderId, businessId: input.businessId,
          branchId: input.branchId,
        });
        if (!result.credit.replayed) {
          await this.audit.recordWithin(transaction, {
            actor: this.auditActor(input.actor, input.businessId),
            sessionId: input.actor.sessionId,
            actionType: 'SUBSCRIPTION_VERIFICATION_PREPARED',
            recordType: 'SUBSCRIPTION_ORDER', recordId: input.orderId,
            businessId: input.businessId, branchId: input.branchId,
            newValue: { creditDecision: result.credit.decision },
          });
        }
        return result;
      });
    } catch (error) {
      if (error instanceof SubscriptionProofMatchError) {
        throw new UnprocessableEntityException(
          'Payment proof does not match the selected bank, account, or plan price',
        );
      }
      if (error instanceof SubscriptionVerificationScopeError) {
        throw new NotFoundException('Eligible subscription purchase not found');
      }
      if (error instanceof SubscriptionVerificationOutcomeConflictError) {
        throw new ConflictException('Subscription verification idempotency conflict');
      }
      throw error;
    }
  }

  private assertOwner(businessId: string, actor: AuthenticatedPrincipal) {
    if (actor.identityType !== 'BUSINESS_USER' ||
        !['PRIMARY_OWNER', 'ADDITIONAL_OWNER'].includes(actor.role) ||
        !actor.businessIds.includes(businessId) || !actor.membershipId ||
        !actor.membershipRoleId) {
      throw new ForbiddenException('Active Owner business context required');
    }
  }

  private auditActor(actor: AuthenticatedPrincipal,
    businessId: string): V2SelectedAuthContext {
    return { identityType: 'BUSINESS_USER', subjectId: actor.userId,
      role: actor.role as V2SelectedAuthContext['role'], businessId,
      membershipId: actor.membershipId, membershipRoleId: actor.membershipRoleId,
      branchId: actor.branchId };
  }
}
