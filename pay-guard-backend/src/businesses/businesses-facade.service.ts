import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { BusinessesService } from './businesses.service';
import { BusinessStatusDto } from './dto/business-status.dto';
import { RegisterBusinessDto } from './dto/register-business.dto';
import { V2BusinessesService } from './v2-businesses.service';

@Injectable()
export class BusinessesFacadeService {
  constructor(
    private readonly legacy: BusinessesService,
    private readonly v2: V2BusinessesService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  register(input: RegisterBusinessDto) {
    return this.isV2() ? this.v2.register(input) : this.legacy.register(input);
  }

  list(principal: AuthenticatedPrincipal) {
    return this.isV2() ? this.v2.list(principal) : this.legacy.list(principal);
  }

  changeStatus(
    businessId: string,
    input: BusinessStatusDto,
    actor: AuthenticatedPrincipal,
  ) {
    return this.isV2()
      ? this.v2.changeStatus(businessId, input, actor)
      : this.legacy.changeStatus(businessId, input, actor);
  }

  private isV2(): boolean {
    return this.config.databaseSchemaVersion === 'v2';
  }
}
