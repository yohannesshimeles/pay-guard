import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LedgerModule } from '../ledger/ledger.module';
import { WithdrawalController } from './withdrawal.controller';
import { WithdrawalDao } from './withdrawal.dao';
import { WithdrawalService } from './withdrawal.service';
import { NotificationModule } from '../notifications/notification.module';

@Module({
  imports: [AuthModule, LedgerModule, NotificationModule],
  controllers: [WithdrawalController],
  providers: [WithdrawalDao, WithdrawalService],
})
export class WithdrawalModule {}
