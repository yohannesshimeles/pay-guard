import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RedeemRecoveryAuthorizationDto } from './dto/recovery-authorization.dto';
import { RecoveryAuthorizationService } from './recovery-authorization.service';

@ApiTags('Subscription Recovery')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('businesses/:businessId/subscription-purchase-lock')
export class RecoveryAuthorizationController {
  constructor(private readonly recovery: RecoveryAuthorizationService) {}

  @Post('recover')
  @Roles('BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER')
  recover(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Body() input: RedeemRecoveryAuthorizationDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) { return this.recovery.redeem(businessId, input, actor); }
}

