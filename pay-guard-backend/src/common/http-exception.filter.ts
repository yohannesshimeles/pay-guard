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

    const message =
      typeof raw === 'object' && raw !== null && 'message' in raw
        ? (raw as { message: string | string[] }).message
        : numericStatus === 500
          ? 'An unexpected error occurred'
          : exception instanceof Error
            ? exception.message
            : 'Request failed';

    if (numericStatus >= 500) {
      this.logger.error(
        JSON.stringify({
          event: 'request.failed',
          correlationId,
          status,
          error: exception instanceof Error ? exception.name : 'UnknownError',
        }),
      );
    }

    void response.status(status).send({
      success: false,
      message: Array.isArray(message) ? 'Validation failed' : message,
      data: null,
      error: {
        code: `HTTP_${status}`,
        details: Array.isArray(message) ? message : undefined,
      },
      correlationId,
    });
  }
}
