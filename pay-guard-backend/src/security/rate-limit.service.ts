import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  APP_CONFIG,
  AppConfig,
  DEFAULT_RATE_LIMIT_CONFIG,
} from '../config/app-config';
import { RedisService } from '../redis/redis.service';
import { RateLimitPolicy } from './rate-limit-policy';

const fixedWindowScript = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return { current, ttl }
`;

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

@Injectable()
export class RateLimitService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly redis: RedisService,
  ) {}

  async consume(policy: RateLimitPolicy, clientAddress: string): Promise<RateLimitDecision> {
    const limits = this.config.rateLimit ?? DEFAULT_RATE_LIMIT_CONFIG;
    await this.redis.ensureConnected();
    const clientKey = createHash('sha256').update(clientAddress).digest('hex');
    const result = await this.redis.client.eval(
      fixedWindowScript,
      1,
      `payguard:rate-limit:${policy.name}:${clientKey}`,
      String(limits.windowMs),
    );
    if (!Array.isArray(result) || result.length !== 2) {
      throw new Error('Invalid rate-limit store response');
    }
    const count = Number(result[0]);
    const ttlMs = Math.max(0, Number(result[1]));
    if (!Number.isSafeInteger(count) || !Number.isFinite(ttlMs)) {
      throw new Error('Invalid rate-limit store response');
    }
    return {
      allowed: count <= policy.limit,
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - count),
      retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1_000)),
    };
  }
}
