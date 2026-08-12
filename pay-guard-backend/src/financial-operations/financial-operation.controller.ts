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
import { CorrectionService } from './correction.service';
import {
  ApproveReversalDto,
  CreateCorrectionDto,
  ListCorrectionsDto,
} from './dto/financial-operation.dto';
import { ReversalApprovalService } from './reversal-approval.service';

@ApiTags('Balance Corrections')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('businesses/:businessId/branches/:branchId/corrections')
export class CorrectionController {
  constructor(private readonly corrections: CorrectionService) {}

  @Post()
  @Roles('MANAGER')
  create(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Body() input: CreateCorrectionDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.corrections.create(businessId, branchId, input, actor);
  }

  @Get()
  @Roles('BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER', 'MANAGER')
  list(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Query() input: ListCorrectionsDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.corrections.list(businessId, branchId, input, actor);
  }

  @Get(':correctionId')
  @Roles('BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER', 'MANAGER')
  require(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('correctionId', new ParseUUIDPipe()) correctionId: string,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.corrections.require(businessId, branchId, correctionId, actor);
  }
}

@ApiTags('Ledger Reversal Approvals')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('businesses/:businessId/branches/:branchId/ledger')
export class ReversalApprovalController {
  constructor(private readonly approvals: ReversalApprovalService) {}

  @Post(':entryId/reversal-approvals')
  @Roles('MANAGER')
  approve(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
    @Body() input: ApproveReversalDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.approvals.approve(businessId, branchId, entryId, input, actor);
  }
}
