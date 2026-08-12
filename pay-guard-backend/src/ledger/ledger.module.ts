import { Module } from '@nestjs/common';
import { LedgerDao } from './ledger.dao';
import { LedgerPostingService } from './ledger-posting.service';
import { AuthModule } from '../auth/auth.module';
import { LedgerController } from './ledger.controller';
import { LedgerQueryDao } from './ledger-query.dao';
import { LedgerQueryService } from './ledger-query.service';

@Module({
  imports: [AuthModule],
  controllers: [LedgerController],
  providers: [LedgerDao, LedgerPostingService, LedgerQueryDao, LedgerQueryService],
  exports: [LedgerDao, LedgerPostingService, LedgerQueryDao, LedgerQueryService],
})
export class LedgerModule {}
