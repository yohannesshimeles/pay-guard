import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  AcknowledgeReceiptReviewCaseDto,
  ListReceiptReviewCasesDto,
  ReceiptReviewAgeingSummaryDto,
  ResolveReceiptReviewCaseDto,
} from './dto/receipt-review-case.dto';
import { ReceiptReviewCaseService } from './receipt-review-case.service';

@ApiTags('Receipt Review Queue')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles('BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER', 'MANAGER')
@Controller('businesses/:businessId/receipt-review-queue')
export class ReceiptReviewCaseController {
  constructor(private readonly cases: ReceiptReviewCaseService) {}

  @Get()
  list(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Query() input: ListReceiptReviewCasesDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.cases.list(businessId, input, actor);
  }

  @Get('ageing-summary')
  ageingSummary(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Query() input: ReceiptReviewAgeingSummaryDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.cases.ageingSummary(businessId, input, actor);
  }

  @Get(':caseId/history')
  history(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.cases.history(businessId, caseId, actor);
  }

  @Post(':caseId/acknowledge')
  acknowledge(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
    @Body() input: AcknowledgeReceiptReviewCaseDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.cases.acknowledge(businessId, caseId, input, actor);
  }

  @Post(':caseId/resolve')
  resolve(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
    @Body() input: ResolveReceiptReviewCaseDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.cases.resolve(businessId, caseId, input, actor);
  }
}
