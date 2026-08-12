import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ListTransactionsDto } from './dto/list-transactions.dto';
import { TransactionQueryService } from './transaction-query.service';
import { ReceiptReviewSummaryDto } from './dto/receipt-review-summary.dto';

@ApiTags('Transactions')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles(
  'PLATFORM_SUPER_ADMIN',
  'BUSINESS_OWNER',
  'PRIMARY_OWNER',
  'ADDITIONAL_OWNER',
  'MANAGER',
  'CASHIER',
  'WAITER',
)
@Controller('businesses/:businessId/transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionQueryService) {}

  @Get()
  list(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Query() input: ListTransactionsDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.transactions.list(businessId, input, actor);
  }

  @Get('receipt-review-summary')
  receiptReviewSummary(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Query() input: ReceiptReviewSummaryDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.transactions.receiptReviewSummary(businessId, input, actor);
  }

  @Get(':transactionId')
  require(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('transactionId', new ParseUUIDPipe()) transactionId: string,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.transactions.require(businessId, transactionId, actor);
  }

  @Get(':transactionId/verification-outcomes')
  verificationOutcomes(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('transactionId', new ParseUUIDPipe()) transactionId: string,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.transactions.verificationOutcomes(
      businessId,
      transactionId,
      actor,
    );
  }

  @Get(':transactionId/history')
  history(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('transactionId', new ParseUUIDPipe()) transactionId: string,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.transactions.history(businessId, transactionId, actor);
  }

  @Get(':transactionId/receipt-decisions')
  receiptDecisions(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('transactionId', new ParseUUIDPipe()) transactionId: string,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.transactions.receiptDecisions(
      businessId,
      transactionId,
      actor,
    );
  }
}
