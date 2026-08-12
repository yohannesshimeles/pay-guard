import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LedgerModule } from '../ledger/ledger.module';
import { CorrectionDao } from './correction.dao';
import { CorrectionService } from './correction.service';
import {
  CorrectionController,
  ReversalApprovalController,
} from './financial-operation.controller';
import { ReversalApprovalDao } from './reversal-approval.dao';
import { ReversalApprovalService } from './reversal-approval.service';
import { NotificationModule } from '../notifications/notification.module';

@Module({
  imports: [AuthModule, LedgerModule, NotificationModule],
  controllers: [CorrectionController, ReversalApprovalController],
  providers: [
    CorrectionDao,
    CorrectionService,
    ReversalApprovalDao,
    ReversalApprovalService,
  ],
})
export class FinancialOperationModule {}
