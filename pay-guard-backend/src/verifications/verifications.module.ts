import { Module } from '@nestjs/common';
import { VerificationStateMachineService } from './verification-state-machine.service';
import { VerificationTransitionDao } from './verification-transition.dao';
import { VerificationCreditEligibilityDao } from './verification-credit-eligibility.dao';
import { VerificationAttemptDao } from './verification-attempt.dao';
import { VerificationPreparationService } from './verification-preparation.service';
import { PendingRecheckDao } from './pending-recheck.dao';
import { PendingRecheckCoordinatorService } from './pending-recheck-coordinator.service';
import { VerificationOutcomeService } from './verification-outcome.service';
import { VerifiedPaymentPostingService } from './verified-payment-posting.service';
import { LedgerModule } from '../ledger/ledger.module';
import { NotificationModule } from '../notifications/notification.module';

@Module({
  imports: [LedgerModule, NotificationModule],
  providers: [
    VerificationStateMachineService,
    VerificationTransitionDao,
    VerificationCreditEligibilityDao,
    VerificationAttemptDao,
    VerificationPreparationService,
    PendingRecheckDao,
    PendingRecheckCoordinatorService,
    VerificationOutcomeService,
    VerifiedPaymentPostingService,
  ],
  exports: [
    VerificationStateMachineService,
    VerificationTransitionDao,
    VerificationCreditEligibilityDao,
    VerificationAttemptDao,
    VerificationPreparationService,
    PendingRecheckDao,
    PendingRecheckCoordinatorService,
    VerificationOutcomeService,
    VerifiedPaymentPostingService,
  ],
})
export class VerificationsModule {}
