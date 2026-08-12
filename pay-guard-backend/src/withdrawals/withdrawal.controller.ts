import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateWithdrawalDto, ListWithdrawalsDto } from './dto/withdrawal.dto';
import { WithdrawalService } from './withdrawal.service';

@ApiTags('Withdrawals')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('businesses/:businessId/branches/:branchId/withdrawals')
export class WithdrawalController {
  constructor(private readonly withdrawals: WithdrawalService) {}

  @Post()
  @Roles('CASHIER')
  create(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Body() input: CreateWithdrawalDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.withdrawals.create(businessId, branchId, input, actor);
  }

  @Get()
  @Roles('BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER', 'MANAGER', 'CASHIER')
  list(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Query() input: ListWithdrawalsDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.withdrawals.list(businessId, branchId, input, actor);
  }

  @Get(':withdrawalId')
  @Roles('BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER', 'MANAGER', 'CASHIER')
  require(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('withdrawalId', new ParseUUIDPipe()) withdrawalId: string,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.withdrawals.require(businessId, branchId, withdrawalId, actor);
  }
}
