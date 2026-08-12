import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { AuthService } from './auth.service';
import { AuthenticatedPrincipal } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { V2AuthService } from './v2-auth.service';

@Injectable()
export class AuthFacadeService {
  constructor(
    private readonly legacy: AuthService,
    private readonly v2: V2AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  login(input: LoginDto) {
    return this.isV2() ? this.v2.login(input) : this.legacy.login(input);
  }

  refresh(refreshToken: string) {
    return this.isV2()
      ? this.v2.refresh(refreshToken)
      : this.legacy.refresh(refreshToken);
  }

  logout(refreshToken: string) {
    return this.isV2()
      ? this.v2.logout(refreshToken)
      : this.legacy.logout(refreshToken);
  }

  verifyAccessToken(token: string): Promise<AuthenticatedPrincipal> {
    return this.isV2()
      ? this.v2.verifyAccessToken(token)
      : this.legacy.verifyAccessToken(token);
  }

  private isV2(): boolean {
    return this.config.databaseSchemaVersion === 'v2';
  }
}
