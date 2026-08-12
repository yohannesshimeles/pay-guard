import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { AuditService } from '../../src/audit/audit.service';
import { AuthRepository } from '../../src/auth/auth.repository';
import { AuthService } from '../../src/auth/auth.service';
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
  databaseSchemaVersion: 'legacy',
  databaseUrl: 'postgresql://test:test@localhost/test',
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

describe('AuthService', () => {
  const repository = {
    findUserByIdentity: jest.fn(),
    createSession: jest.fn(),
    findActiveSessionByTokenHash: jest.fn(),
    rotateSession: jest.fn(),
    getUserContext: jest.fn(),
    revokeSession: jest.fn(),
    isSessionActive: jest.fn(),
  };
  const passwords = { verify: jest.fn(), hash: jest.fn() };
  const jwt = { signAsync: jest.fn(), verifyAsync: jest.fn() };
  const audit = { record: jest.fn() };
  const service = new AuthService(
    repository as unknown as AuthRepository,
    passwords,
    jwt as unknown as JwtService,
    audit as unknown as AuditService,
    config,
  );

  beforeEach(() => jest.clearAllMocks());

  it('creates an audited branch-scoped session on valid login', async () => {
    repository.findUserByIdentity.mockResolvedValue({
      id: 'user-1',
      passwordHash: 'hash',
      status: 'ACTIVE',
      role: 'MANAGER',
      businessIds: [],
      branchId: 'branch-1',
    });
    passwords.verify.mockResolvedValue(true);
    repository.createSession.mockResolvedValue({ sessionId: 'session-1' });
    jwt.signAsync.mockResolvedValue('access-token');

    const result = await service.login({
      identity: 'manager@example.com',
      password: 'correct-password',
      devicePlatform: 'web',
    });

    expect(result.principal).toMatchObject({
      userId: 'user-1',
      role: 'MANAGER',
      branchId: 'branch-1',
    });
    expect(repository.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'MANAGER', userId: 'user-1' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AUTH_LOGIN' }),
    );
  });

  it('returns the same generic error for invalid login', async () => {
    repository.findUserByIdentity.mockResolvedValue(undefined);
    passwords.verify.mockResolvedValue(false);

    await expect(
      service.login({
        identity: 'unknown@example.com',
        password: 'bad-password',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rotates refresh tokens atomically', async () => {
    repository.findActiveSessionByTokenHash.mockResolvedValue({
      id: 'session-1',
      user_id: 'user-1',
      device_id: null,
    });
    repository.getUserContext.mockResolvedValue({
      id: 'user-1',
      passwordHash: 'hash',
      status: 'ACTIVE',
      role: 'BUSINESS_OWNER',
      businessIds: ['business-1'],
    });
    repository.rotateSession.mockResolvedValue(true);
    jwt.signAsync.mockResolvedValue('next-access-token');

    const result = await service.refresh('a'.repeat(64));

    expect(result.refreshToken).not.toBe('a'.repeat(64));
    expect(repository.rotateSession).toHaveBeenCalledTimes(1);
  });

  it('checks session revocation for every access token', async () => {
    jwt.verifyAsync.mockResolvedValue({
      userId: 'user-1',
      sessionId: 'session-1',
      role: 'WAITER',
      businessIds: [],
      branchId: 'branch-1',
    });
    repository.isSessionActive.mockResolvedValue(false);

    await expect(service.verifyAccessToken('token')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
