import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccountCryptoService } from '../common/account-crypto.service';
import { BanksController } from './banks.controller';
import { BanksFacadeService } from './banks-facade.service';
import { BanksService } from './banks.service';
import { V2BanksService } from './v2-banks.service';

@Module({
  imports: [AuthModule],
  controllers: [BanksController],
  providers: [
    BanksService,
    V2BanksService,
    BanksFacadeService,
    AccountCryptoService,
  ],
})
export class BanksModule {}
