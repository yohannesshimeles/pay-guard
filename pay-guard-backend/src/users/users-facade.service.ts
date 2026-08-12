import { Inject, Injectable } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { CreateStaffDto, RemoveStaffDto } from './dto/staff.dto';
import { UsersService } from './users.service';
import { V2UsersService } from './v2-users.service';

@Injectable()
export class UsersFacadeService {
  constructor(
    private readonly legacy: UsersService,
    private readonly v2: V2UsersService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  createStaff(
    businessId: string,
    branchId: string,
    input: CreateStaffDto,
    actor: AuthenticatedPrincipal,
  ) {
    return this.isV2()
      ? this.v2.createStaff(businessId, branchId, input, actor)
      : this.legacy.createStaff(businessId, branchId, input, actor);
  }

  list(
    businessId: string,
    branchId: string,
    actor: AuthenticatedPrincipal,
    includeRemoved = false,
  ) {
    return this.isV2()
      ? this.v2.list(businessId, branchId, actor, includeRemoved)
      : this.legacy.list(businessId, branchId, actor, includeRemoved);
  }

  remove(
    businessId: string,
    branchId: string,
    userId: string,
    input: RemoveStaffDto,
    actor: AuthenticatedPrincipal,
  ) {
    return this.isV2()
      ? this.v2.remove(businessId, branchId, userId, input, actor)
      : this.legacy.remove(businessId, branchId, userId, input, actor);
  }

  private isV2(): boolean {
    return this.config.databaseSchemaVersion === 'v2';
  }
}
