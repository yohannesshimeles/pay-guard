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
import {
  CreateReconciliationDto,
  DecideReconciliationDto,
  ListReconciliationsDto,
} from './dto/reconciliation.dto';
import { ReconciliationService } from './reconciliation.service';

@ApiTags('Daily Reconciliations')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('businesses/:businessId/branches/:branchId/reconciliations')
export class ReconciliationController {
  constructor(private readonly reconciliations: ReconciliationService) {}

  @Post()
  @Roles('CASHIER')
  create(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Body() input: CreateReconciliationDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.reconciliations.create(businessId, branchId, input, actor);
  }

  @Post(':reconciliationId/submit')
  @Roles('CASHIER')
  submit(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('reconciliationId', new ParseUUIDPipe()) reconciliationId: string,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.reconciliations.submit(
      businessId, branchId, reconciliationId, actor,
    );
  }

  @Post(':reconciliationId/decision')
  @Roles('MANAGER')
  decide(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('reconciliationId', new ParseUUIDPipe()) reconciliationId: string,
    @Body() input: DecideReconciliationDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.reconciliations.decide(
      businessId, branchId, reconciliationId, input, actor,
    );
  }

  @Get()
  @Roles('BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER', 'MANAGER', 'CASHIER')
  list(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Query() input: ListReconciliationsDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.reconciliations.list(businessId, branchId, input, actor);
  }

  @Get(':reconciliationId')
  @Roles('BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER', 'MANAGER', 'CASHIER')
  require(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('reconciliationId', new ParseUUIDPipe()) reconciliationId: string,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.reconciliations.require(
      businessId, branchId, reconciliationId, actor,
    );
  }
}
