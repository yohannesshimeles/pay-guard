import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreditQueryService } from './credit-query.service';
import { ListCreditHistoryDto } from './dto/credit-query.dto';

@ApiTags('Branch Credits')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles('BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER', 'MANAGER', 'CASHIER')
@Controller('businesses/:businessId/branches/:branchId/credits')
export class CreditController {
  constructor(private readonly credits: CreditQueryService) {}

  @Get()
  wallet(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.credits.wallet(businessId, branchId, actor);
  }

  @Get('history')
  history(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Query() input: ListCreditHistoryDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.credits.history(businessId, branchId, input, actor);
  }
}
