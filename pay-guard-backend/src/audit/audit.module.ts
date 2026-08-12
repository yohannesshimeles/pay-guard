import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { V2AuditService } from './v2-audit.service';

@Global()
@Module({
  providers: [AuditService, V2AuditService],
  exports: [AuditService, V2AuditService],
})
export class AuditModule {}
