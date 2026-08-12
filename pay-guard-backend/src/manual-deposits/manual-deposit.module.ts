import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LedgerModule } from '../ledger/ledger.module';
import { QrProcessingModule } from '../qr-processing/qr-processing.module';
import { ManualDepositAttachmentService } from './manual-deposit-attachment.service';
import { ManualDepositController } from './manual-deposit.controller';
import { ManualDepositDao } from './manual-deposit.dao';
import { ManualDepositService } from './manual-deposit.service';
import { NotificationModule } from '../notifications/notification.module';

@Module({
  imports: [AuthModule, LedgerModule, QrProcessingModule, NotificationModule],
  controllers: [ManualDepositController],
  providers: [ManualDepositDao, ManualDepositService, ManualDepositAttachmentService],
})
export class ManualDepositModule {}
