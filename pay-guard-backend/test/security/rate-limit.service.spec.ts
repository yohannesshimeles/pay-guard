import { AppConfig } from '../../src/config/app-config';
import { RedisService } from '../../src/redis/redis.service';
import { RateLimitService } from '../../src/security/rate-limit.service';

describe('RateLimitService', () => {
  const evalCommand = jest.fn();
  const connect = jest.fn();
  const ensureConnected = jest.fn();
  const redis = {
    client: { status: 'ready', eval: evalCommand, connect }, ensureConnected,
  } as unknown as RedisService;
  const config = {
    rateLimit: {
      enabled: true,
      windowMs: 60_000,
      globalMax: 300,
      authMax: 2,
      uploadMax: 20,
    },
  } as AppConfig;
  const service = new RateLimitService(config, redis);
  const policy = { name: 'auth' as const, limit: 2, failClosed: true };

  beforeEach(() => jest.clearAllMocks());

  it('returns remaining quota without storing the raw client address', async () => {
    evalCommand.mockResolvedValue([1, 59_100]);
    await expect(service.consume(policy, '203.0.113.42')).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
      retryAfterSeconds: 60,
    });
    const call = evalCommand.mock.calls[0] as unknown[];
    expect(call[2]).toMatch(/^payguard:rate-limit:auth:[a-f0-9]{64}$/u);
    expect(call.join(' ')).not.toContain('203.0.113.42');
  });

  it('blocks once the fixed-window quota is exceeded', async () => {
    evalCommand.mockResolvedValue([3, 2_500]);
    await expect(service.consume(policy, '203.0.113.42')).resolves.toEqual({
      allowed: false,
      limit: 2,
      remaining: 0,
      retryAfterSeconds: 3,
    });
  });

  it('rejects malformed store responses', async () => {
    evalCommand.mockResolvedValue('unexpected');
    await expect(service.consume(policy, '203.0.113.42'))
      .rejects.toThrow('Invalid rate-limit store response');
  });
});
