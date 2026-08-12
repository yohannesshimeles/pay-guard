import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ListLedgerEntriesDto, ProjectedBalanceDto } from './dto/ledger-query.dto';
import { LedgerQueryService } from './ledger-query.service';

@ApiTags('Ledger')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles('BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER', 'MANAGER', 'CASHIER')
@Controller('businesses/:businessId/ledger')
export class LedgerController {
  constructor(private readonly ledger: LedgerQueryService) {}

  @Get()
  list(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Query() input: ListLedgerEntriesDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.ledger.list(businessId, input, actor);
  }

  @Get('accounts/:accountId/projected-balance')
  projectedBalance(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('accountId', new ParseUUIDPipe()) accountId: string,
    @Query() input: ProjectedBalanceDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.ledger.projectedBalance(businessId, accountId, input, actor);
  }

  @Get(':entryId')
  require(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.ledger.require(businessId, entryId, actor);
  }
}
