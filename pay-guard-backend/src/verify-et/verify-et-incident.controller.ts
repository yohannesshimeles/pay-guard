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
  AcknowledgeVerifyEtIncidentDto,
  ListVerifyEtIncidentsDto,
} from './dto/verify-et-incident.dto';
import { VerifyEtIncidentService } from './verify-et-incident.service';

@ApiTags('Platform Provider Incidents')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles('PLATFORM_SUPER_ADMIN')
@Controller('platform/provider-incidents')
export class VerifyEtIncidentController {
  constructor(private readonly incidents: VerifyEtIncidentService) {}

  @Get()
  list(
    @Query() input: ListVerifyEtIncidentsDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.incidents.list(input, actor);
  }

  @Get(':incidentId')
  require(
    @Param('incidentId', new ParseUUIDPipe()) incidentId: string,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.incidents.require(incidentId, actor);
  }

  @Post(':incidentId/acknowledge')
  acknowledge(
    @Param('incidentId', new ParseUUIDPipe()) incidentId: string,
    @Body() input: AcknowledgeVerifyEtIncidentDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.incidents.acknowledge(incidentId, input, actor);
  }
}
