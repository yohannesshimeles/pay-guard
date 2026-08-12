import { Injectable } from '@nestjs/common';
import { PendingRecheckEntity } from './entities/pending-recheck.entity';
import { VerificationAttemptEntity } from './entities/verification-attempt.entity';
import { VerificationAttemptType } from './enums/verification-attempt-type.enum';
import { PendingRecheckStatus } from './enums/pending-recheck-status.enum';
import { PendingRecheckDao } from './pending-recheck.dao';
import { VerificationPreparationService } from './verification-preparation.service';

export type PendingRecheckPreparation = Readonly<{
  decision: 'PREPARED' | 'WAITING_CREDITS' | 'PAUSED_BRANCH';
  recheck: PendingRecheckEntity;
}>;

export type ActivePendingRecheckPreparation =
  | Readonly<{
      decision: 'PREPARED';
      recheck: PendingRecheckEntity;
      attempt: VerificationAttemptEntity;
    }>
  | Readonly<{
      decision: 'WAITING_CREDITS' | 'PAUSED_BRANCH';
      recheck: PendingRecheckEntity;
    }>;

@Injectable()
export class PendingRecheckCoordinatorService {
  constructor(
    private readonly rechecks: PendingRecheckDao,
    private readonly preparations: VerificationPreparationService,
  ) {}

  async prepareClaim(
    claim: PendingRecheckEntity,
  ): Promise<PendingRecheckPreparation> {
    const active = await this.prepareActiveClaim(claim);
    if (active.decision !== 'PREPARED') return active;
    return {
      decision: 'PREPARED',
      recheck: await this.rechecks.completeClaim(
        active.recheck.id,
        claim.claimToken!,
        active.attempt.id,
      ),
    };
  }

  async prepareActiveClaim(
    claim: PendingRecheckEntity,
  ): Promise<ActivePendingRecheckPreparation> {
    if (claim.status !== PendingRecheckStatus.CLAIMED || !claim.claimToken) {
      throw new Error('Pending recheck must have an active worker claim');
    }
    const preparation = await this.preparations.prepare({
      transactionId: claim.transactionId,
      businessId: claim.businessId,
      branchId: claim.branchId,
      attemptType: VerificationAttemptType.RECHECK,
      attemptKey: `verification:recheck:${claim.transactionId}:${claim.recheckNumber}`,
    });
    if (preparation.decision === 'PREPARED') {
      return {
        decision: 'PREPARED',
        recheck: await this.rechecks.bindAttemptToClaim(
          claim.id,
          claim.claimToken,
          preparation.attempt.id,
        ),
        attempt: preparation.attempt,
      };
    }

    const pauseStatus =
      preparation.decision === 'WAITING_CREDITS'
        ? PendingRecheckStatus.WAITING_CREDITS
        : PendingRecheckStatus.PAUSED_BRANCH;
    return {
      decision: preparation.decision,
      recheck: await this.rechecks.pauseClaim(
        claim.id,
        claim.claimToken,
        pauseStatus,
        preparation.decision === 'WAITING_CREDITS'
          ? 'CREDITS_EXHAUSTED'
          : 'BRANCH_NOT_ACTIVE',
      ),
    };
  }
}
