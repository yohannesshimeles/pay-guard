import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditQueryDao } from './audit-query.dao';
import { AuditQueryService } from './audit-query.service';
import { BusinessAuditController, PlatformAuditController } from './audit.controller';

@Module({
  imports: [AuthModule],
  controllers: [BusinessAuditController, PlatformAuditController],
  providers: [AuditQueryDao, AuditQueryService],
  exports: [AuditQueryDao, AuditQueryService],
})
export class AuditQueryModule {}
