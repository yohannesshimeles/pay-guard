import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Observable, catchError, finalize, throwError } from 'rxjs';
import { requestContext } from '../common/request-context';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestLoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const response = context.switchToHttp().getResponse<FastifyReply>();
    const started = process.hrtime.bigint();
    let errorStatus: number | undefined;

    return next.handle().pipe(
      catchError((error: unknown) => {
        errorStatus = error instanceof HttpException ? error.getStatus() : 500;
        return throwError(() => error);
      }),
      finalize(() => {
        const status = errorStatus ?? response.statusCode;
        const durationMs = Math.round(
          Number(process.hrtime.bigint() - started) / 1_000_000,
        );
        const record = JSON.stringify({
          event: 'request.completed',
          correlationId: requestContext.getStore()?.correlationId ?? 'unknown',
          method: request.method,
          route: request.routeOptions?.url ?? 'unknown',
          status,
          outcome:
            status >= 500 ? 'SERVER_ERROR' : status >= 400 ? 'CLIENT_ERROR' : 'SUCCESS',
          durationMs,
        });

        if (status >= 500) this.logger.error(record);
        else if (status >= 400) this.logger.warn(record);
        else this.logger.log(record);
      }),
    );
  }
}
