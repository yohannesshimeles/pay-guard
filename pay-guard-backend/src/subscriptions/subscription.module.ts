import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { QrProcessingModule } from '../qr-processing/qr-processing.module';
import { CreditModule } from '../credits/credit.module';
import { VerifyEtModule } from '../verify-et/verify-et.module';
import { FraudModule } from '../fraud/fraud.module';
import { SubscriptionPurchaseController } from './subscription-purchase.controller';
import { SubscriptionPurchaseDao } from './subscription-purchase.dao';
import { SubscriptionPurchaseService } from './subscription-purchase.service';
import { SubscriptionVerificationDao } from './subscription-verification.dao';
import { SubscriptionVerificationService } from './subscription-verification.service';
import { SubscriptionFraudDao } from './subscription-fraud.dao';

@Module({
  imports: [AuthModule, AuditModule, QrProcessingModule, CreditModule, VerifyEtModule,
    FraudModule],
  controllers: [SubscriptionPurchaseController],
  providers: [SubscriptionPurchaseDao, SubscriptionPurchaseService,
    SubscriptionVerificationDao, SubscriptionVerificationService, SubscriptionFraudDao],
  exports: [SubscriptionPurchaseDao, SubscriptionPurchaseService,
    SubscriptionVerificationDao, SubscriptionVerificationService, SubscriptionFraudDao],
})
export class SubscriptionModule {}
