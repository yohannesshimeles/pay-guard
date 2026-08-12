import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { BanksFacadeService } from './banks-facade.service';
import {
  CreatePlatformAccountDto,
  CreateSettlementAccountDto,
  CreateBankDto,
  UpdatePlatformAccountDto,
  UpdateBankDto,
} from './dto/account.dto';

@ApiTags('Banks and Settlement Accounts')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller()
export class BanksController {
  constructor(private readonly banks: BanksFacadeService) {}

  @Get('banks')
  @Roles('PLATFORM_SUPER_ADMIN', 'BUSINESS_OWNER', 'MANAGER', 'CASHIER')
  listBanks(
    @Query('includeDisabled') includeDisabled: string | undefined,
    @CurrentUser() user: AuthenticatedPrincipal,
  ) {
    return this.banks.listBanks(includeDisabled === 'true', user);
  }

  @Patch('banks/:bankId')
  @Roles('PLATFORM_SUPER_ADMIN')
  updateBank(
    @Param('bankId', new ParseUUIDPipe()) bankId: string,
    @Body() input: UpdateBankDto,
    @CurrentUser() user: AuthenticatedPrincipal,
  ) {
    return this.banks.updateBank(bankId, input, user);
  }

  @Post('banks')
  @Roles('PLATFORM_SUPER_ADMIN')
  createBank(
    @Body() input: CreateBankDto,
    @CurrentUser() user: AuthenticatedPrincipal,
  ) {
    return this.banks.createBank(input, user);
  }

  @Post('businesses/:businessId/branches/:branchId/settlement-accounts')
  @Roles('PLATFORM_SUPER_ADMIN', 'BUSINESS_OWNER')
  createBranchAccount(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Body() input: CreateSettlementAccountDto,
    @CurrentUser() user: AuthenticatedPrincipal,
  ) {
    return this.banks.createBranchAccount(businessId, branchId, input, user);
  }

  @Get('businesses/:businessId/branches/:branchId/settlement-accounts')
  @Roles('PLATFORM_SUPER_ADMIN', 'BUSINESS_OWNER')
  listBranchAccounts(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @CurrentUser() user: AuthenticatedPrincipal,
  ) {
    return this.banks.listBranchAccounts(businessId, branchId, user);
  }

  @Post('businesses/:businessId/branches/:branchId/settlement-accounts/:accountId/deactivate')
  @Roles('PLATFORM_SUPER_ADMIN', 'BUSINESS_OWNER')
  deactivateBranchAccount(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('accountId', new ParseUUIDPipe()) accountId: string,
    @CurrentUser() user: AuthenticatedPrincipal,
  ) {
    return this.banks.deactivateBranchAccount(
      businessId,
      branchId,
      accountId,
      user,
    );
  }

  @Post('platform/subscription-settlement-accounts')
  @Roles('PLATFORM_SUPER_ADMIN')
  createPlatformAccount(
    @Body() input: CreatePlatformAccountDto,
    @CurrentUser() user: AuthenticatedPrincipal,
  ) {
    return this.banks.createPlatformAccount(input, user);
  }

  @Get('platform/subscription-settlement-accounts')
  @Roles('PLATFORM_SUPER_ADMIN')
  listPlatformAccounts(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.banks.listPlatformAccounts(user);
  }

  @Patch('platform/subscription-settlement-accounts/:accountId')
  @Roles('PLATFORM_SUPER_ADMIN')
  updatePlatformAccount(
    @Param('accountId', new ParseUUIDPipe()) accountId: string,
    @Body() input: UpdatePlatformAccountDto,
    @CurrentUser() user: AuthenticatedPrincipal,
  ) {
    return this.banks.updatePlatformAccount(accountId, input, user);
  }
}
