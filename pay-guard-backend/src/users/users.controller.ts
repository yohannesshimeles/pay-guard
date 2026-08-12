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
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CreateStaffDto, RemoveStaffDto } from './dto/staff.dto';
import { UsersFacadeService } from './users-facade.service';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles('PLATFORM_SUPER_ADMIN', 'BUSINESS_OWNER')
@Controller('businesses/:businessId/branches/:branchId/users')
export class UsersController {
  constructor(private readonly users: UsersFacadeService) {}

  @Post()
  create(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Body() input: CreateStaffDto,
    @CurrentUser() user: AuthenticatedPrincipal,
  ) {
    return this.users.createStaff(businessId, branchId, input, user);
  }

  @Get()
  list(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Query('includeRemoved') includeRemoved: string | undefined,
    @CurrentUser() user: AuthenticatedPrincipal,
  ) {
    return this.users.list(
      businessId,
      branchId,
      user,
      includeRemoved === 'true',
    );
  }

  @Post(':userId/remove')
  remove(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() input: RemoveStaffDto,
    @CurrentUser() user: AuthenticatedPrincipal,
  ) {
    return this.users.remove(businessId, branchId, userId, input, user);
  }
}
