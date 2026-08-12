import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppConfig } from './config/app-config';
import { CorrelationMiddleware } from './common/correlation.middleware';
import { ConfigModule } from './config/config.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { ObservabilityModule } from './observability/observability.module';
import { RedisModule } from './redis/redis.module';
import { StorageModule } from './storage/storage.module';
import { BanksModule } from './banks/banks.module';
import { BranchesModule } from './branches/branches.module';
import { BusinessesModule } from './businesses/businesses.module';
import { UsersModule } from './users/users.module';
import { QrProcessingModule } from './qr-processing/qr-processing.module';
import { VerifyEtModule } from './verify-et/verify-et.module';
import { VerificationsModule } from './verifications/verifications.module';
import { TransactionsModule } from './transactions/transactions.module';
import { LedgerModule } from './ledger/ledger.module';
import { ManualDepositModule } from './manual-deposits/manual-deposit.module';
import { WithdrawalModule } from './withdrawals/withdrawal.module';
import { FinancialOperationModule } from './financial-operations/financial-operation.module';
import { ReconciliationModule } from './reconciliations/reconciliation.module';
import { CreditModule } from './credits/credit.module';
import { SubscriptionModule } from './subscriptions/subscription.module';
import { FraudModule } from './fraud/fraud.module';
import { NotificationModule } from './notifications/notification.module';
import { ReportsModule } from './reports/reports.module';
import { AuditQueryModule } from './audit/audit-query.module';

@Module({
  imports: [
    DatabaseModule,
    RedisModule,
    StorageModule,
    ObservabilityModule,
    AuditModule,
    AuthModule,
    AuditQueryModule,
    HealthModule,
    BusinessesModule,
    BranchesModule,
    UsersModule,
    BanksModule,
    QrProcessingModule,
    VerifyEtModule,
    VerificationsModule,
    TransactionsModule,
    LedgerModule,
    ManualDepositModule,
    WithdrawalModule,
    FinancialOperationModule,
    ReconciliationModule,
    CreditModule,
    SubscriptionModule,
    FraudModule,
    NotificationModule,
    ReportsModule,
  ],
})
export class AppModule implements NestModule {
  static register(config: AppConfig) {
    return {
      module: AppModule,
      imports: [ConfigModule.register(config)],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
