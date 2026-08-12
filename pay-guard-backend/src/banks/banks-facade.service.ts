import { Inject, Injectable } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { BanksService } from './banks.service';
import {
  CreateBankDto,
  CreatePlatformAccountDto,
  CreateSettlementAccountDto,
  UpdateBankDto,
  UpdatePlatformAccountDto,
} from './dto/account.dto';
import { V2BanksService } from './v2-banks.service';

@Injectable()
export class BanksFacadeService {
  constructor(
    private readonly legacy: BanksService,
    private readonly v2: V2BanksService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  listBanks(includeDisabled: boolean, actor: AuthenticatedPrincipal) {
    return this.pick().listBanks(includeDisabled, actor);
  }

  updateBank(bankId: string, input: UpdateBankDto, actor: AuthenticatedPrincipal) {
    return this.pick().updateBank(bankId, input, actor);
  }

  createBank(input: CreateBankDto, actor: AuthenticatedPrincipal) {
    return this.pick().createBank(input, actor);
  }

  createBranchAccount(
    businessId: string,
    branchId: string,
    input: CreateSettlementAccountDto,
    actor: AuthenticatedPrincipal,
  ) {
    return this.pick().createBranchAccount(businessId, branchId, input, actor);
  }

  listBranchAccounts(
    businessId: string,
    branchId: string,
    actor: AuthenticatedPrincipal,
  ) {
    return this.pick().listBranchAccounts(businessId, branchId, actor);
  }

  deactivateBranchAccount(
    businessId: string,
    branchId: string,
    accountId: string,
    actor: AuthenticatedPrincipal,
  ) {
    return this.pick().deactivateBranchAccount(
      businessId,
      branchId,
      accountId,
      actor,
    );
  }

  createPlatformAccount(
    input: CreatePlatformAccountDto,
    actor: AuthenticatedPrincipal,
  ) {
    return this.pick().createPlatformAccount(input, actor);
  }

  listPlatformAccounts(actor: AuthenticatedPrincipal) {
    return this.pick().listPlatformAccounts(actor);
  }

  updatePlatformAccount(
    accountId: string,
    input: UpdatePlatformAccountDto,
    actor: AuthenticatedPrincipal,
  ) {
    return this.pick().updatePlatformAccount(accountId, input, actor);
  }

  private pick(): BanksService | V2BanksService {
    return this.config.databaseSchemaVersion === 'v2' ? this.v2 : this.legacy;
  }
}
