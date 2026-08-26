import {
  AppConfig,
  DEFAULT_RATE_LIMIT_CONFIG,
} from '../config/app-config';

export type RateLimitPolicy = {
  name: 'auth' | 'upload' | 'global';
  limit: number;
  failClosed: boolean;
};

const uploadRoute = /^\/api\/v1\/transactions\/[^/]+\/receipts\/?$/u;

export function selectRateLimitPolicy(
  rawUrl: string,
  config: AppConfig,
): RateLimitPolicy | undefined {
  const path = rawUrl.split('?', 1)[0].replace(/\/$/u, '') || '/';
  if (['/health/live', '/health/ready', '/metrics'].includes(path)) {
    return undefined;
  }

  const limits = config.rateLimit ?? DEFAULT_RATE_LIMIT_CONFIG;
  if (!limits.enabled) return undefined;
  if (path === '/api/v1/auth/login' || path === '/api/v1/auth/refresh') {
    return { name: 'auth', limit: limits.authMax, failClosed: true };
  }
  if (uploadRoute.test(path)) {
    return { name: 'upload', limit: limits.uploadMax, failClosed: true };
  }
  return { name: 'global', limit: limits.globalMax, failClosed: false };
}
