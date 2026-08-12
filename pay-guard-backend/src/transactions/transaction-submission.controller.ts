import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { TransactionSubmissionService } from './transaction-submission.service';

@ApiTags('Transactions')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles('BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER', 'MANAGER', 'CASHIER', 'WAITER')
@Controller('businesses/:businessId/branches/:branchId/transactions')
export class TransactionSubmissionController {
  constructor(private readonly submissions: TransactionSubmissionService) {}

  @Post()
  create(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Body() input: CreateTransactionDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.submissions.create(businessId, branchId, input, actor);
  }
}
