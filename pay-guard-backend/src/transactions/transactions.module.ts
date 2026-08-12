import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TransactionQueryDao } from './transaction-query.dao';
import { TransactionQueryService } from './transaction-query.service';
import { TransactionsController } from './transactions.controller';
import { TransactionSubmissionController } from './transaction-submission.controller';
import { TransactionSubmissionDao } from './transaction-submission.dao';
import { TransactionSubmissionService } from './transaction-submission.service';
import { ReceiptReviewCaseController } from './receipt-review-case.controller';
import { ReceiptReviewCaseDao } from './receipt-review-case.dao';
import { ReceiptReviewCaseService } from './receipt-review-case.service';

@Module({
  imports: [AuthModule],
  controllers: [
    TransactionsController,
    TransactionSubmissionController,
    ReceiptReviewCaseController,
  ],
  providers: [
    TransactionQueryDao,
    TransactionQueryService,
    TransactionSubmissionDao,
    TransactionSubmissionService,
    ReceiptReviewCaseDao,
    ReceiptReviewCaseService,
  ],
  exports: [
    TransactionQueryDao,
    TransactionQueryService,
    TransactionSubmissionDao,
    TransactionSubmissionService,
  ],
})
export class TransactionsModule {}
