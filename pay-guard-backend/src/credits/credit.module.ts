import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CreditController } from './credit.controller';
import { CreditQueryDao } from './credit-query.dao';
import { CreditQueryService } from './credit-query.service';
import { CreditLifecycleDao } from './credit-lifecycle.dao';
import { CreditLifecycleService } from './credit-lifecycle.service';
import { NotificationModule } from '../notifications/notification.module';

@Module({
  imports: [AuthModule, NotificationModule],
  controllers: [CreditController],
  providers: [
    CreditQueryDao, CreditQueryService, CreditLifecycleDao, CreditLifecycleService,
  ],
  exports: [
    CreditQueryDao, CreditQueryService, CreditLifecycleDao, CreditLifecycleService,
  ],
})
export class CreditModule {}
