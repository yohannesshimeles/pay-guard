import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { BusinessesFacadeService } from './businesses-facade.service';
import { BusinessStatusDto } from './dto/business-status.dto';
import { RegisterBusinessDto } from './dto/register-business.dto';

@ApiTags('Businesses')
@Controller('businesses')
export class BusinessesController {
  constructor(private readonly businesses: BusinessesFacadeService) {}

  @Post('register')
  register(@Body() input: RegisterBusinessDto) {
    return this.businesses.register(input);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('PLATFORM_SUPER_ADMIN', 'BUSINESS_OWNER')
  list(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.businesses.list(user);
  }

  @Patch(':businessId/status')
  @ApiBearerAuth()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('PLATFORM_SUPER_ADMIN')
  changeStatus(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Body() input: BusinessStatusDto,
    @CurrentUser() user: AuthenticatedPrincipal,
  ) {
    return this.businesses.changeStatus(businessId, input, user);
  }
}
