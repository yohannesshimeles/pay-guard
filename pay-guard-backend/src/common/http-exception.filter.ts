import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { requestContext } from './request-context';
import { describeError } from './safe-error';
import { resolvePublicError } from './error-contract';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<FastifyReply>();
    const correlationId = requestContext.getStore()?.correlationId ?? 'unknown';
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const numericStatus = Number(status);
    const raw =
      exception instanceof HttpException ? exception.getResponse() : undefined;

    const error = resolvePublicError(exception, numericStatus, raw);

    if (numericStatus >= 500) {
      this.logger.error(
        JSON.stringify({
          event: 'request.failed',
          correlationId,
          status,
          error: describeError(exception),
        }),
      );
    }

    void response.status(status).send({
      success: false,
      message: error.description,
      data: null,
      error,
      correlationId,
    });
  }
}
