import { Inject, Injectable } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { BranchesService } from './branches.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';
import { V2BranchesService } from './v2-branches.service';

@Injectable()
export class BranchesFacadeService {
  constructor(
    private readonly legacy: BranchesService,
    private readonly v2: V2BranchesService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  create(
    businessId: string,
    input: CreateBranchDto,
    actor: AuthenticatedPrincipal,
  ) {
    return this.isV2()
      ? this.v2.create(businessId, input, actor)
      : this.legacy.create(businessId, input, actor);
  }

  list(businessId: string, actor: AuthenticatedPrincipal) {
    return this.isV2()
      ? this.v2.list(businessId, actor)
      : this.legacy.list(businessId, actor);
  }

  update(
    businessId: string,
    branchId: string,
    input: UpdateBranchDto,
    actor: AuthenticatedPrincipal,
  ) {
    return this.isV2()
      ? this.v2.update(businessId, branchId, input, actor)
      : this.legacy.update(businessId, branchId, input, actor);
  }

  private isV2(): boolean {
    return this.config.databaseSchemaVersion === 'v2';
  }
}
