import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationDao } from './reconciliation.dao';
import { ReconciliationService } from './reconciliation.service';
import { NotificationModule } from '../notifications/notification.module';

@Module({
  imports: [AuthModule, NotificationModule],
  controllers: [ReconciliationController],
  providers: [ReconciliationDao, ReconciliationService],
})
export class ReconciliationModule {}
