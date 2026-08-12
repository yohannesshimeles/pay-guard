import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { V2AuditService } from '../audit/v2-audit.service';
import { AppConfig, APP_CONFIG } from '../config/app-config';
import { Inject } from '@nestjs/common';
import { AuthenticatedPrincipal } from './auth.types';
import { PasswordService } from './password.service';
import { V2AuthRepository } from './v2-auth.repository';
import {
  V2ContextSelection,
  V2ContextSelectionResult,
  V2SelectedAuthContext,
} from './v2-auth.types';
import { V2ContextSelectorService } from './v2-context-selector.service';
import { V2SessionRepository } from './v2-session.repository';
import { V2Session } from './v2-session.types';

type V2TokenPair = {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresIn: number;
};

export type V2LoginResult =
  | {
      status: 'CONTEXT_SELECTION_REQUIRED';
      contexts: Extract<
        V2ContextSelectionResult,
        { status: 'SELECTION_REQUIRED' }
      >['contexts'];
    }
  | (V2TokenPair & {
      status: 'AUTHENTICATED';
      principal: Omit<AuthenticatedPrincipal, 'sessionId'>;
    });

@Injectable()
export class V2AuthService {
  constructor(
    private readonly identities: V2AuthRepository,
    private readonly sessions: V2SessionRepository,
    private readonly contexts: V2ContextSelectorService,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
    private readonly audit: V2AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async login(input: {
    identity: string;
    password: string;
    context?: V2ContextSelection;
    deviceIdentifier?: string;
    devicePlatform?: 'web' | 'android' | 'ios';
  }): Promise<V2LoginResult> {
    const identity = await this.identities.findIdentity(input.identity.trim());
    const valid =
      identity?.status === 'ACTIVE' &&
      (await this.passwords.verify(
        input.password,
        identity?.passwordHash ??
          '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv',
      ));
    if (!identity || !valid) throw this.invalidCredentials();

    const selected = this.contexts.select(identity, input.context);
    if (selected.status === 'SELECTION_REQUIRED') {
      return {
        status: 'CONTEXT_SELECTION_REQUIRED',
        contexts: selected.contexts,
      };
    }

    const rawRefreshToken = this.newRefreshToken();
    const refreshTokenHash = this.hashToken(rawRefreshToken);
    const expiresAt = this.futureDate(this.config.refreshTokenTtlSeconds);
    const deviceIdentifierHash = input.deviceIdentifier
      ? this.hashToken(input.deviceIdentifier)
      : undefined;
    const sessionId = await this.createSession({
      context: selected.context,
      refreshTokenHash,
      expiresAt,
      deviceIdentifierHash,
      devicePlatform: input.devicePlatform,
    });
    const principal = this.toPrincipal(selected.context, sessionId);

    try {
      const tokenPair = await this.issueTokenPair(principal, rawRefreshToken);
      await this.audit.record({
        actor: selected.context,
        sessionId,
        actionType: 'AUTH_LOGIN',
        recordType: 'SESSION',
        recordId: sessionId,
        newValue: { devicePlatform: input.devicePlatform ?? null },
      });
      return {
        status: 'AUTHENTICATED',
        ...tokenPair,
        principal: this.withoutSessionId(principal),
      };
    } catch (error) {
      await this.sessions.revoke({
        sessionKind: selected.context.identityType,
        sessionId,
        subjectId: selected.context.subjectId,
        reason: 'Login completion failed',
      });
      throw error;
    }
  }

  async refresh(rawRefreshToken: string): Promise<V2TokenPair> {
    const currentHash = this.hashToken(rawRefreshToken);
    const session = await this.sessions.findActiveByRefreshTokenHash(currentHash);
    if (!session || !(await this.sessionIsActive(session))) {
      throw new UnauthorizedException('Session is invalid or expired');
    }

    const context = this.contextFromSession(session);
    const nextRefreshToken = this.newRefreshToken();
    const nextHash = this.hashToken(nextRefreshToken);
    const nextExpiry = this.futureDate(this.config.refreshTokenTtlSeconds);
    const principal = this.toPrincipal(context, session.id);
    const tokenPair = await this.issueTokenPair(principal, nextRefreshToken);
    const rotated = await this.sessions.rotateRefreshToken({
      sessionKind: session.sessionKind,
      sessionId: session.id,
      currentHash,
      nextHash,
      nextExpiry,
    });
    if (!rotated) throw new UnauthorizedException('Session is invalid or expired');

    try {
      await this.audit.record({
        actor: context,
        sessionId: session.id,
        actionType: 'AUTH_REFRESH',
        recordType: 'SESSION',
        recordId: session.id,
      });
      return tokenPair;
    } catch (error) {
      await this.sessions.revoke({
        sessionKind: session.sessionKind,
        sessionId: session.id,
        subjectId: session.subjectId,
        reason: 'Refresh audit failed',
      });
      throw error;
    }
  }

  async logout(rawRefreshToken: string): Promise<{ loggedOut: true }> {
    const session = await this.sessions.findActiveByRefreshTokenHash(
      this.hashToken(rawRefreshToken),
    );
    if (!session) return { loggedOut: true };

    const context = this.contextFromSession(session);
    const revoked = await this.sessions.revoke({
      sessionKind: session.sessionKind,
      sessionId: session.id,
      subjectId: session.subjectId,
      reason: 'User logout',
    });
    if (revoked) {
      await this.audit.record({
        actor: context,
        sessionId: session.id,
        actionType: 'AUTH_LOGOUT',
        recordType: 'SESSION',
        recordId: session.id,
      });
    }
    return { loggedOut: true };
  }

  async verifyAccessToken(token: string): Promise<AuthenticatedPrincipal> {
    try {
      const principal = await this.jwt.verifyAsync<AuthenticatedPrincipal>(token, {
        secret: this.config.jwtAccessSecret,
      });
      if (!principal.identityType) throw new Error('Missing V2 identity type');
      const active = await this.sessions.isActive({
        sessionKind: principal.identityType,
        sessionId: principal.sessionId,
        subjectId: principal.userId,
      });
      if (!active) throw new Error('Inactive V2 session');
      return principal;
    } catch {
      throw new UnauthorizedException('Access token is invalid or expired');
    }
  }

  private async createSession(input: {
    context: V2SelectedAuthContext;
    refreshTokenHash: string;
    expiresAt: Date;
    deviceIdentifierHash?: string;
    devicePlatform?: 'web' | 'android' | 'ios';
  }): Promise<string> {
    if (input.context.identityType === 'PLATFORM_ADMIN') {
      const session = await this.sessions.createPlatformAdminSession({
        platformAdminId: input.context.subjectId,
        refreshTokenHash: input.refreshTokenHash,
        expiresAt: input.expiresAt,
        deviceIdentifierHash: input.deviceIdentifierHash,
        devicePlatform: input.devicePlatform,
      });
      return session.sessionId;
    }

    if (!input.context.membershipId || !input.context.membershipRoleId) {
      throw new UnauthorizedException('Authorization context is invalid');
    }
    const session = await this.sessions.createBusinessSession({
      userId: input.context.subjectId,
      membershipId: input.context.membershipId,
      membershipRoleId: input.context.membershipRoleId,
      workAssignmentId: input.context.workAssignmentId,
      refreshTokenHash: input.refreshTokenHash,
      expiresAt: input.expiresAt,
      deviceIdentifierHash: input.deviceIdentifierHash,
      devicePlatform: input.devicePlatform,
    });
    return session.sessionId;
  }

  private contextFromSession(session: V2Session): V2SelectedAuthContext {
    return {
      identityType: session.sessionKind,
      subjectId: session.subjectId,
      role: session.role,
      businessId: session.businessId,
      membershipId: session.membershipId,
      membershipRoleId: session.membershipRoleId,
      workAssignmentId: session.workAssignmentId,
      workScope: session.workScope,
      branchId: session.branchId,
    };
  }

  private sessionIsActive(session: V2Session): Promise<boolean> {
    return this.sessions.isActive({
      sessionKind: session.sessionKind,
      sessionId: session.id,
      subjectId: session.subjectId,
    });
  }

  private toPrincipal(
    context: V2SelectedAuthContext,
    sessionId: string,
  ): AuthenticatedPrincipal {
    return {
      userId: context.subjectId,
      sessionId,
      identityType: context.identityType,
      role: context.role,
      businessIds: context.businessId ? [context.businessId] : [],
      branchId: context.branchId,
      membershipId: context.membershipId,
      membershipRoleId: context.membershipRoleId,
      workAssignmentId: context.workAssignmentId,
    };
  }

  private async issueTokenPair(
    principal: AuthenticatedPrincipal,
    refreshToken: string,
  ): Promise<V2TokenPair> {
    return {
      accessToken: await this.jwt.signAsync(principal, {
        subject: principal.userId,
        expiresIn: this.config.jwtAccessTtlSeconds,
        secret: this.config.jwtAccessSecret,
      }),
      accessTokenExpiresIn: this.config.jwtAccessTtlSeconds,
      refreshToken,
      refreshTokenExpiresIn: this.config.refreshTokenTtlSeconds,
    };
  }

  private withoutSessionId(
    principal: AuthenticatedPrincipal,
  ): Omit<AuthenticatedPrincipal, 'sessionId'> {
    return {
      userId: principal.userId,
      identityType: principal.identityType,
      role: principal.role,
      businessIds: principal.businessIds,
      branchId: principal.branchId,
      deviceId: principal.deviceId,
      membershipId: principal.membershipId,
      membershipRoleId: principal.membershipRoleId,
      workAssignmentId: principal.workAssignmentId,
    };
  }

  private newRefreshToken(): string {
    return randomBytes(48).toString('base64url');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private futureDate(seconds: number): Date {
    return new Date(Date.now() + seconds * 1_000);
  }

  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException('Invalid credentials');
  }
}
