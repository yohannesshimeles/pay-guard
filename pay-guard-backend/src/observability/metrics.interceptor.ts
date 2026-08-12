import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Observable, finalize } from 'rxjs';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const response = context.switchToHttp().getResponse<FastifyReply>();
    const started = process.hrtime.bigint();

    return next.handle().pipe(
      finalize(() => {
        const duration = Number(process.hrtime.bigint() - started) / 1_000_000_000;
        const route = request.routeOptions?.url ?? 'unknown';
        const status = String(response.statusCode);
        const labels = { method: request.method, route, status };
        this.metrics.httpRequests.inc(labels);
        this.metrics.httpDuration.observe(labels, duration);
      }),
    );
  }
}
