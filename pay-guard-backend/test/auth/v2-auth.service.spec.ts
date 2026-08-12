import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { V2AuditService } from '../../src/audit/v2-audit.service';
import { V2AuthRepository } from '../../src/auth/v2-auth.repository';
import { V2AuthService } from '../../src/auth/v2-auth.service';
import { V2ContextSelectorService } from '../../src/auth/v2-context-selector.service';
import { PasswordService } from '../../src/auth/password.service';
import { V2SessionRepository } from '../../src/auth/v2-session.repository';
import {
  AppConfig,
  DEFAULT_CLAMAV_CONFIG,
  DEFAULT_DATABASE_POOL_CONFIG,
  DEFAULT_VERIFYET_CONFIG,
} from '../../src/config/app-config';

const config: AppConfig = {
  firebase: { enabled: false, timeoutMs: 8_000 },
  notificationWorkerPollMs: 2_000,
  environment: 'test',
  port: 4000,
  logLevel: 'error',
  databaseSchemaVersion: 'v2',
  databaseUrl: 'postgresql://test:test@localhost/payguard_v2_test',
  databasePool: DEFAULT_DATABASE_POOL_CONFIG,
  clamav: DEFAULT_CLAMAV_CONFIG,
  verifyEt: DEFAULT_VERIFYET_CONFIG,
  redisUrl: 'redis://localhost:6379',
  jwtAccessSecret: 'test-secret-that-is-longer-than-thirty-two-characters',
  jwtAccessTtlSeconds: 900,
  refreshTokenTtlSeconds: 3600,
  passwordResetTtlSeconds: 300,
  s3: {
    endpoint: 'http://localhost:9000',
    region: 'us-east-1',
    bucket: 'test',
    accessKeyId: 'test',
    secretAccessKey: 'test-secret-at-least-sixteen',
    forcePathStyle: true,
  },
};

describe('V2AuthService', () => {
  const identities = { findIdentity: jest.fn() };
  const sessions = {
    createBusinessSession: jest.fn(),
    createPlatformAdminSession: jest.fn(),
    findActiveByRefreshTokenHash: jest.fn(),
    rotateRefreshToken: jest.fn(),
    revoke: jest.fn(),
    isActive: jest.fn(),
  };
  const passwords = { verify: jest.fn() };
  const jwt = { signAsync: jest.fn(), verifyAsync: jest.fn() };
  const audit = { record: jest.fn() };
  const service = new V2AuthService(
    identities as unknown as V2AuthRepository,
    sessions as unknown as V2SessionRepository,
    new V2ContextSelectorService(),
    passwords as unknown as PasswordService,
    jwt as unknown as JwtService,
    audit as unknown as V2AuditService,
    config,
  );

  const contexts = [
    {
      membershipId: 'membership-1',
      membershipRoleId: 'role-1',
      role: 'MANAGER' as const,
      businessId: 'business-1',
      workAssignmentId: 'assignment-1',
      workScope: 'BRANCH' as const,
      branchId: 'branch-1',
    },
    {
      membershipId: 'membership-1',
      membershipRoleId: 'role-2',
      role: 'PRIMARY_OWNER' as const,
      businessId: 'business-1',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    identities.findIdentity.mockResolvedValue({
      id: 'user-1',
      identityType: 'BUSINESS_USER',
      passwordHash: 'hash',
      status: 'ACTIVE',
      contexts,
    });
    passwords.verify.mockResolvedValue(true);
    sessions.createBusinessSession.mockResolvedValue({
      sessionId: 'session-1',
    });
    sessions.revoke.mockResolvedValue(true);
    jwt.signAsync.mockResolvedValue('access-token');
    audit.record.mockResolvedValue(undefined);
  });

  it('returns contexts without creating a session when selection is required', async () => {
    const result = await service.login({
      identity: 'user@example.test',
      password: 'correct-password',
    });

    expect(result).toMatchObject({
      status: 'CONTEXT_SELECTION_REQUIRED',
      contexts,
    });
    expect(sessions.createBusinessSession).not.toHaveBeenCalled();
  });

  it('creates and audits a session for an exact selected context', async () => {
    const result = await service.login({
      identity: 'user@example.test',
      password: 'correct-password',
      context: {
        membershipId: 'membership-1',
        membershipRoleId: 'role-1',
        workAssignmentId: 'assignment-1',
      },
      devicePlatform: 'web',
    });

    expect(result).toMatchObject({
      status: 'AUTHENTICATED',
      accessToken: 'access-token',
      principal: {
        userId: 'user-1',
        role: 'MANAGER',
        businessIds: ['business-1'],
        branchId: 'branch-1',
      },
    });
    expect(sessions.createBusinessSession).toHaveBeenCalledWith(
      expect.objectContaining({
        membershipRoleId: 'role-1',
      }),
    );
    expect(JSON.stringify(sessions.createBusinessSession.mock.calls)).toMatch(
      /[a-f0-9]{64}/,
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'AUTH_LOGIN' }),
    );
  });

  it('revokes the new session if mandatory audit persistence fails', async () => {
    audit.record.mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(
      service.login({
        identity: 'user@example.test',
        password: 'correct-password',
        context: {
          membershipId: 'membership-1',
          membershipRoleId: 'role-2',
        },
      }),
    ).rejects.toThrow('audit unavailable');
    expect(sessions.revoke).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'Login completion failed' }),
    );
  });

  it('revokes the new session if access-token signing fails', async () => {
    jwt.signAsync.mockRejectedValueOnce(new Error('signing unavailable'));

    await expect(
      service.login({
        identity: 'user@example.test',
        password: 'correct-password',
        context: {
          membershipId: 'membership-1',
          membershipRoleId: 'role-2',
        },
      }),
    ).rejects.toThrow('signing unavailable');
    expect(sessions.revoke).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'Login completion failed' }),
    );
  });

  it('returns the same generic failure for unknown or invalid credentials', async () => {
    identities.findIdentity.mockResolvedValueOnce(undefined);
    passwords.verify.mockResolvedValueOnce(false);

    await expect(
      service.login({
        identity: 'missing@example.test',
        password: 'wrong-pass',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('revalidates context and rotates the refresh token atomically', async () => {
    sessions.findActiveByRefreshTokenHash.mockResolvedValueOnce({
      id: 'session-1',
      sessionKind: 'BUSINESS_USER',
      subjectId: 'user-1',
      membershipId: 'membership-1',
      membershipRoleId: 'role-1',
      workAssignmentId: 'assignment-1',
      role: 'MANAGER',
      businessId: 'business-1',
      workScope: 'BRANCH',
      branchId: 'branch-1',
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    sessions.isActive.mockResolvedValueOnce(true);
    sessions.rotateRefreshToken.mockResolvedValueOnce(true);

    const result = await service.refresh('a'.repeat(64));

    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).not.toBe('a'.repeat(64));
    expect(sessions.isActive.mock.invocationCallOrder[0]).toBeLessThan(
      sessions.rotateRefreshToken.mock.invocationCallOrder[0],
    );
    expect(sessions.rotateRefreshToken).toHaveBeenCalled();
    expect(JSON.stringify(sessions.rotateRefreshToken.mock.calls)).toMatch(
      /[a-f0-9]{64}/,
    );
  });

  it('rejects an access token when its V2 session is no longer active', async () => {
    jwt.verifyAsync.mockResolvedValueOnce({
      userId: 'user-1',
      sessionId: 'session-1',
      identityType: 'BUSINESS_USER',
      role: 'MANAGER',
      businessIds: ['business-1'],
    });
    sessions.isActive.mockResolvedValueOnce(false);

    await expect(service.verifyAccessToken('token')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
