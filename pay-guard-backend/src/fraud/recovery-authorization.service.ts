import { createHash, randomBytes } from 'node:crypto';
import {
  ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { V2AuditService } from '../audit/v2-audit.service';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { V2SelectedAuthContext } from '../auth/v2-auth.types';
import { deterministicUuid } from '../common/deterministic-uuid';
import { CentralDao } from '../database/central.dao';
import {
  IssueRecoveryAuthorizationDto, RedeemRecoveryAuthorizationDto,
  RevokeRecoveryAuthorizationDto,
} from './dto/recovery-authorization.dto';
import {
  FraudReviewRecoveryScopeError, RecoveryAuthorizationConflictError,
  RecoveryAuthorizationDao, RecoveryAuthorizationInvalidError,
} from './recovery-authorization.dao';

@Injectable()
export class RecoveryAuthorizationService {
  constructor(
    private readonly centralDao: CentralDao,
    private readonly recovery: RecoveryAuthorizationDao,
    private readonly audit: V2AuditService,
  ) {}

  async issue(fraudReviewId: string, input: IssueRecoveryAuthorizationDto,
    actor: AuthenticatedPrincipal) {
    this.assertPlatformAdmin(actor);
    const authorizationCode = `PGRC-${randomBytes(24).toString('base64url')}`;
    try {
      const result = await this.centralDao.transaction(async (transaction) => {
        const issued = await this.recovery.issueWithin(transaction, {
          id: deterministicUuid(`recovery-code:${input.requestKey}`),
          requestKey: input.requestKey, fraudReviewId,
          codeHash: this.hash(authorizationCode),
          deliveredToUserId: input.deliveredToUserId,
          reviewNote: input.reviewNote, expiresInMinutes: input.expiresInMinutes,
          platformAdminId: actor.userId,
        });
        await this.audit.recordWithin(transaction, {
          actor: this.adminActor(actor), sessionId: actor.sessionId,
          actionType: 'FRAUD_RECOVERY_AUTHORIZATION_ISSUED',
          recordType: 'RECOVERY_CODE', recordId: issued.id,
          businessId: issued.businessId,
          newValue: { fraudReviewId, purchaseLockId: issued.purchaseLockId,
            deliveredToUserId: issued.deliveredToUserId,
            expiresAt: issued.expiresAt, status: issued.status },
          reason: input.reviewNote,
        });
        return issued;
      });
      return { recovery: result, authorizationCode };
    } catch (error) {
      if (error instanceof FraudReviewRecoveryScopeError) {
        throw new NotFoundException(
          'Open fraud review, active purchase lock, or intended active Owner was not found',
        );
      }
      if (error instanceof RecoveryAuthorizationConflictError ||
          (error as { code?: string }).code === '23505') {
        throw new ConflictException(
          'An active recovery authorization already exists or the request was already used',
        );
      }
      throw error;
    }
  }

  async revoke(fraudReviewId: string, recoveryCodeId: string,
    input: RevokeRecoveryAuthorizationDto, actor: AuthenticatedPrincipal) {
    this.assertPlatformAdmin(actor);
    try {
      return await this.centralDao.transaction(async (transaction) => {
        const revoked = await this.recovery.revokeWithin(transaction, {
          fraudReviewId, recoveryCodeId, platformAdminId: actor.userId,
          reason: input.reason,
        });
        await this.audit.recordWithin(transaction, {
          actor: this.adminActor(actor), sessionId: actor.sessionId,
          actionType: 'FRAUD_RECOVERY_AUTHORIZATION_REVOKED',
          recordType: 'RECOVERY_CODE', recordId: revoked.id,
          businessId: revoked.businessId,
          newValue: { purchaseLockId: revoked.purchaseLockId,
            status: revoked.status }, reason: input.reason,
        });
        return revoked;
      });
    } catch (error) {
      if (error instanceof FraudReviewRecoveryScopeError) {
        throw new NotFoundException('Recovery authorization was not found');
      }
      if (error instanceof RecoveryAuthorizationConflictError) {
        throw new ConflictException('Recovery authorization is no longer active');
      }
      throw error;
    }
  }

  async redeem(businessId: string, input: RedeemRecoveryAuthorizationDto,
    actor: AuthenticatedPrincipal) {
    this.assertOwner(businessId, actor);
    try {
      return await this.centralDao.transaction(async (transaction) => {
        const used = await this.recovery.redeemWithin(transaction, {
          businessId, userId: actor.userId,
          codeHash: this.hash(input.authorizationCode.trim()),
        });
        await this.audit.recordWithin(transaction, {
          actor: this.ownerActor(actor, businessId), sessionId: actor.sessionId,
          actionType: 'FRAUD_RECOVERY_AUTHORIZATION_REDEEMED',
          recordType: 'RECOVERY_CODE', recordId: used.id, businessId,
          newValue: { purchaseLockId: used.purchaseLockId,
            status: used.status, unlocked: true },
        });
        return { recovery: used, purchaseUnlocked: true };
      });
    } catch (error) {
      if (error instanceof RecoveryAuthorizationInvalidError) {
        throw new ConflictException('Recovery authorization is invalid or unavailable');
      }
      throw error;
    }
  }

  private hash(value: string) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }

  private assertPlatformAdmin(actor: AuthenticatedPrincipal) {
    if (actor.identityType !== 'PLATFORM_ADMIN' ||
        actor.role !== 'PLATFORM_SUPER_ADMIN') {
      throw new ForbiddenException('Platform Super Admin access required');
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

  private adminActor(actor: AuthenticatedPrincipal): V2SelectedAuthContext {
    return { identityType: 'PLATFORM_ADMIN', subjectId: actor.userId,
      role: 'PLATFORM_SUPER_ADMIN' };
  }

  private ownerActor(actor: AuthenticatedPrincipal,
    businessId: string): V2SelectedAuthContext {
    return { identityType: 'BUSINESS_USER', subjectId: actor.userId,
      role: actor.role as V2SelectedAuthContext['role'], businessId,
      membershipId: actor.membershipId, membershipRoleId: actor.membershipRoleId,
      branchId: actor.branchId };
  }
}

