import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { MetricsService } from '../observability/metrics.service';
import { selectRateLimitPolicy } from './rate-limit-policy';
import { RateLimitService } from './rate-limit.service';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly limiter: RateLimitService,
    private readonly metrics: MetricsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const response = http.getResponse<FastifyReply>();
    const policy = selectRateLimitPolicy(request.url, this.config);
    if (!policy) return true;

    try {
      const decision = await this.limiter.consume(policy, request.ip || 'unknown');
      response.header('x-ratelimit-limit', String(decision.limit));
      response.header('x-ratelimit-remaining', String(decision.remaining));
      response.header('x-ratelimit-reset', String(decision.retryAfterSeconds));
      this.metrics.rateLimitDecisions.inc({
        policy: policy.name,
        outcome: decision.allowed ? 'allowed' : 'blocked',
      });
      if (!decision.allowed) {
        response.header('retry-after', String(decision.retryAfterSeconds));
        throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
      }
      return true;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.metrics.rateLimitStoreErrors.inc({ policy: policy.name });
      this.logger.error(JSON.stringify({
        event: 'rate_limit.store_unavailable',
        policy: policy.name,
        failClosed: policy.failClosed,
      }));
      if (policy.failClosed) {
        throw new ServiceUnavailableException(
          'Request protection is temporarily unavailable',
        );
      }
      this.metrics.rateLimitDecisions.inc({
        policy: policy.name,
        outcome: 'store_bypass',
      });
      return true;
    }
  }
}
