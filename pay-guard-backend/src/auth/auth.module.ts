import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuditModule } from '../audit/audit.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { RolesGuard } from './roles.guard';
import { V2AuthRepository } from './v2-auth.repository';
import { V2SessionRepository } from './v2-session.repository';
import { V2ContextSelectorService } from './v2-context-selector.service';
import { V2AuthService } from './v2-auth.service';
import { AuthFacadeService } from './auth-facade.service';

@Module({
  imports: [JwtModule.register({}), AuditModule],
  controllers: [AuthController],
  providers: [
    AuthRepository,
    AuthService,
    PasswordService,
    AuthGuard,
    RolesGuard,
    V2AuthRepository,
    V2SessionRepository,
    V2ContextSelectorService,
    V2AuthService,
    AuthFacadeService,
  ],
  exports: [
    AuthService,
    AuthGuard,
    RolesGuard,
    PasswordService,
    V2AuthRepository,
    V2SessionRepository,
    V2ContextSelectorService,
    V2AuthService,
    AuthFacadeService,
  ],
})
export class AuthModule {}
