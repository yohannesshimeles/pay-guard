import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuditQueryService } from './audit-query.service';
import { AuditQueryDto } from './dto/audit-query.dto';

@ApiTags('Audit')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles('BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER', 'MANAGER')
@Controller('businesses/:businessId/audit-logs')
export class BusinessAuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get()
  list(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Query() input: AuditQueryDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.audit.business(businessId, input, actor);
  }
}

@ApiTags('Platform Audit')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles('PLATFORM_SUPER_ADMIN')
@Controller('platform/audit-logs')
export class PlatformAuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get()
  list(
    @Query() input: AuditQueryDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.audit.platform(input, actor);
  }
}
