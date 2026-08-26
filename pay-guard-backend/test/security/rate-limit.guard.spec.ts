import { ExecutionContext, HttpException } from '@nestjs/common';
import { AppConfig } from '../../src/config/app-config';
import { MetricsService } from '../../src/observability/metrics.service';
import { RateLimitGuard } from '../../src/security/rate-limit.guard';
import { RateLimitService } from '../../src/security/rate-limit.service';

describe('RateLimitGuard', () => {
  const consume = jest.fn();
  const decisionInc = jest.fn();
  const errorInc = jest.fn();
  const headers: Record<string, string> = {};
  const response = {
    header: jest.fn((name: string, value: string) => { headers[name] = value; }),
  };
  const request = { url: '/api/v1/auth/login', ip: '203.0.113.42' };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  const config = {
    rateLimit: {
      enabled: true, windowMs: 60_000, globalMax: 300,
      authMax: 10, uploadMax: 20,
    },
  } as AppConfig;
  const guard = new RateLimitGuard(
    config,
    { consume } as unknown as RateLimitService,
    {
      rateLimitDecisions: { inc: decisionInc },
      rateLimitStoreErrors: { inc: errorInc },
    } as unknown as MetricsService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(headers)) delete headers[key];
    request.url = '/api/v1/auth/login';
  });

  it('emits quota headers for an allowed request', async () => {
    consume.mockResolvedValue({
      allowed: true, limit: 10, remaining: 9, retryAfterSeconds: 60,
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(headers).toMatchObject({
      'x-ratelimit-limit': '10',
      'x-ratelimit-remaining': '9',
      'x-ratelimit-reset': '60',
    });
    expect(headers['retry-after']).toBeUndefined();
  });

  it('returns 429 and Retry-After when quota is exceeded', async () => {
    consume.mockResolvedValue({
      allowed: false, limit: 10, remaining: 0, retryAfterSeconds: 12,
    });
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 429,
    });
    expect(headers['retry-after']).toBe('12');
  });

  it('fails closed for auth when Redis enforcement is unavailable', async () => {
    consume.mockRejectedValue(new Error('Redis unavailable'));
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 503 });
    expect(errorInc).toHaveBeenCalledWith({ policy: 'auth' });
  });

  it('fails open for general traffic while recording the bypass', async () => {
    request.url = '/api/v1/transactions';
    consume.mockRejectedValue(new Error('Redis unavailable'));
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(decisionInc).toHaveBeenCalledWith({
      policy: 'global', outcome: 'store_bypass',
    });
  });

  it('does not reinterpret deliberate HTTP rejections as store failures', async () => {
    consume.mockRejectedValue(new HttpException('blocked', 429));
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 429 });
    expect(errorInc).not.toHaveBeenCalled();
  });
});
