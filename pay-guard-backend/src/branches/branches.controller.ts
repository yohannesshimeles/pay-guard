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
import { BranchesFacadeService } from './branches-facade.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

@ApiTags('Branches')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('businesses/:businessId/branches')
export class BranchesController {
  constructor(private readonly branches: BranchesFacadeService) {}

  @Post()
  @Roles('PLATFORM_SUPER_ADMIN', 'BUSINESS_OWNER')
  create(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Body() input: CreateBranchDto,
    @CurrentUser() user: AuthenticatedPrincipal,
  ) {
    return this.branches.create(businessId, input, user);
  }

  @Get()
  @Roles('PLATFORM_SUPER_ADMIN', 'BUSINESS_OWNER', 'MANAGER', 'CASHIER')
  list(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @CurrentUser() user: AuthenticatedPrincipal,
  ) {
    return this.branches.list(businessId, user);
  }

  @Patch(':branchId')
  @Roles('PLATFORM_SUPER_ADMIN', 'BUSINESS_OWNER')
  update(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Body() input: UpdateBranchDto,
    @CurrentUser() user: AuthenticatedPrincipal,
  ) {
    return this.branches.update(businessId, branchId, input, user);
  }
}
