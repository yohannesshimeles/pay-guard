import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { AuthRepository } from './auth.repository';
import { AuthenticatedPrincipal, AuthUser } from './auth.types';
import { PasswordService } from './password.service';

type TokenPair = {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresIn: number;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async login(input: {
    identity: string;
    password: string;
    deviceIdentifier?: string;
    devicePlatform?: string;
  }): Promise<TokenPair & { principal: Omit<AuthenticatedPrincipal, 'sessionId'> }> {
    const user = await this.repository.findUserByIdentity(input.identity.trim());
    const valid =
      user?.status === 'ACTIVE' &&
      (await this.passwords.verify(
        input.password,
        user?.passwordHash ?? '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv',
      ));
    if (!user || !valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const rawRefreshToken = this.newRefreshToken();
    const refreshTokenHash = this.hashToken(rawRefreshToken);
    const refreshExpiry = this.futureDate(this.config.refreshTokenTtlSeconds);
    const deviceIdentifierHash = input.deviceIdentifier
      ? this.hashToken(input.deviceIdentifier)
      : undefined;
    const session = await this.repository.createSession({
      userId: user.id,
      role: user.role,
      refreshTokenHash,
      expiresAt: refreshExpiry,
      deviceIdentifierHash,
      devicePlatform: input.devicePlatform,
    });

    const principal = this.toPrincipal(user, session.sessionId, session.deviceId);
    const accessToken = await this.signAccessToken(principal);
    await this.audit.record({
      actorUserId: user.id,
      branchId: user.branchId,
      action: 'AUTH_LOGIN',
      targetType: 'session',
      targetId: session.sessionId,
      metadata: { role: user.role, devicePlatform: input.devicePlatform },
    });

    return {
      accessToken,
      accessTokenExpiresIn: this.config.jwtAccessTtlSeconds,
      refreshToken: rawRefreshToken,
      refreshTokenExpiresIn: this.config.refreshTokenTtlSeconds,
      principal: {
        userId: principal.userId,
        role: principal.role,
        businessIds: principal.businessIds,
        branchId: principal.branchId,
        deviceId: principal.deviceId,
      },
    };
  }

  async refresh(rawRefreshToken: string): Promise<TokenPair> {
    const currentHash = this.hashToken(rawRefreshToken);
    const session = await this.repository.findActiveSessionByTokenHash(currentHash);
    if (!session) throw new UnauthorizedException('Session is invalid or expired');

    const user = await this.repository.getUserContext(session.user_id);
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Session is invalid or expired');
    }

    const nextRefreshToken = this.newRefreshToken();
    const nextHash = this.hashToken(nextRefreshToken);
    const nextExpiry = this.futureDate(this.config.refreshTokenTtlSeconds);
    const rotated = await this.repository.rotateSession(
      session.id,
      currentHash,
      nextHash,
      nextExpiry,
    );
    if (!rotated) throw new UnauthorizedException('Session is invalid or expired');

    const principal = this.toPrincipal(
      user,
      session.id,
      session.device_id ?? undefined,
    );
    return {
      accessToken: await this.signAccessToken(principal),
      accessTokenExpiresIn: this.config.jwtAccessTtlSeconds,
      refreshToken: nextRefreshToken,
      refreshTokenExpiresIn: this.config.refreshTokenTtlSeconds,
    };
  }

  async logout(rawRefreshToken: string): Promise<{ loggedOut: true }> {
    const hash = this.hashToken(rawRefreshToken);
    const session = await this.repository.findActiveSessionByTokenHash(hash);
    if (session) {
      await this.repository.revokeSession(session.id, session.user_id);
      await this.audit.record({
        actorUserId: session.user_id,
        action: 'AUTH_LOGOUT',
        targetType: 'session',
        targetId: session.id,
      });
    }
    return { loggedOut: true };
  }

  async verifyAccessToken(token: string): Promise<AuthenticatedPrincipal> {
    try {
      const principal = await this.jwt.verifyAsync<AuthenticatedPrincipal>(token, {
        secret: this.config.jwtAccessSecret,
      });
      const active = await this.repository.isSessionActive(
        principal.sessionId,
        principal.userId,
      );
      if (!active) {
        throw new UnauthorizedException('Session is invalid or expired');
      }
      return principal;
    } catch {
      throw new UnauthorizedException('Access token is invalid or expired');
    }
  }

  private toPrincipal(
    user: AuthUser,
    sessionId: string,
    deviceId?: string,
  ): AuthenticatedPrincipal {
    return {
      userId: user.id,
      sessionId,
      role: user.role,
      businessIds: user.businessIds,
      branchId: user.branchId,
      deviceId,
    };
  }

  private signAccessToken(principal: AuthenticatedPrincipal): Promise<string> {
    return this.jwt.signAsync(principal, {
      subject: principal.userId,
      expiresIn: this.config.jwtAccessTtlSeconds,
      secret: this.config.jwtAccessSecret,
    });
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
}
