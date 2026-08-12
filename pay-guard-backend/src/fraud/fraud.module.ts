import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FraudAlertDao } from './fraud-alert.dao';
import { FraudReviewController } from './fraud-review.controller';
import { FraudReviewDao } from './fraud-review.dao';
import { FraudReviewService } from './fraud-review.service';
import { RecoveryAuthorizationController } from './recovery-authorization.controller';
import { RecoveryAuthorizationDao } from './recovery-authorization.dao';
import { RecoveryAuthorizationService } from './recovery-authorization.service';
import { NotificationModule } from '../notifications/notification.module';

@Module({
  imports: [AuthModule, NotificationModule],
  controllers: [FraudReviewController, RecoveryAuthorizationController],
  providers: [FraudAlertDao, FraudReviewDao, FraudReviewService,
    RecoveryAuthorizationDao, RecoveryAuthorizationService],
  exports: [FraudAlertDao, FraudReviewDao, FraudReviewService,
    RecoveryAuthorizationDao, RecoveryAuthorizationService],
})
export class FraudModule {}
