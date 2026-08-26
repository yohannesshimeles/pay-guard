import { AppConfig } from '../../src/config/app-config';
import { selectRateLimitPolicy } from '../../src/security/rate-limit-policy';

const config = {
  rateLimit: {
    enabled: true,
    windowMs: 60_000,
    globalMax: 300,
    authMax: 10,
    uploadMax: 20,
  },
} as AppConfig;

describe('selectRateLimitPolicy', () => {
  it('exempts health and metrics probes', () => {
    expect(selectRateLimitPolicy('/health/live', config)).toBeUndefined();
    expect(selectRateLimitPolicy('/health/ready?full=true', config)).toBeUndefined();
    expect(selectRateLimitPolicy('/metrics', config)).toBeUndefined();
  });

  it('uses fail-closed policies for auth and proof upload routes', () => {
    expect(selectRateLimitPolicy('/api/v1/auth/login', config)).toEqual({
      name: 'auth', limit: 10, failClosed: true,
    });
    expect(selectRateLimitPolicy(
      '/api/v1/transactions/7f39a3a8-5ce1-4b4d-8ac0-cf34eaf35f12/receipts',
      config,
    )).toEqual({ name: 'upload', limit: 20, failClosed: true });
  });

  it('uses the general fail-open policy for other application routes', () => {
    expect(selectRateLimitPolicy('/api/v1/transactions?page=2', config)).toEqual({
      name: 'global', limit: 300, failClosed: false,
    });
  });

  it('supports explicit non-production disablement', () => {
    expect(selectRateLimitPolicy('/api/v1/auth/login', {
      ...config,
      rateLimit: { ...config.rateLimit!, enabled: false },
    })).toBeUndefined();
  });
});
