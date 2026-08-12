import {
  Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ListFraudReviewsDto } from './dto/fraud-review.dto';
import { FraudReviewService } from './fraud-review.service';
import {
  IssueRecoveryAuthorizationDto, RevokeRecoveryAuthorizationDto,
} from './dto/recovery-authorization.dto';
import { RecoveryAuthorizationService } from './recovery-authorization.service';

@ApiTags('Platform Fraud Reviews')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles('PLATFORM_SUPER_ADMIN')
@Controller('platform/fraud-reviews')
export class FraudReviewController {
  constructor(
    private readonly reviews: FraudReviewService,
    private readonly recovery: RecoveryAuthorizationService,
  ) {}

  @Get()
  list(@Query() input: ListFraudReviewsDto,
    @CurrentUser() actor: AuthenticatedPrincipal) {
    return this.reviews.list(input, actor);
  }

  @Get(':fraudReviewId')
  require(@Param('fraudReviewId', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedPrincipal) {
    return this.reviews.require(id, actor);
  }

  @Post(':fraudReviewId/recovery-authorizations')
  issueRecovery(
    @Param('fraudReviewId', new ParseUUIDPipe()) id: string,
    @Body() input: IssueRecoveryAuthorizationDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) { return this.recovery.issue(id, input, actor); }

  @Post(':fraudReviewId/recovery-authorizations/:recoveryCodeId/revoke')
  revokeRecovery(
    @Param('fraudReviewId', new ParseUUIDPipe()) id: string,
    @Param('recoveryCodeId', new ParseUUIDPipe()) recoveryCodeId: string,
    @Body() input: RevokeRecoveryAuthorizationDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) { return this.recovery.revoke(id, recoveryCodeId, input, actor); }
}
