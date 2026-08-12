import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { requestContext } from './request-context';

const validCorrelationId = /^[a-zA-Z0-9._-]{8,128}$/;

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(
    request: FastifyRequest['raw'],
    response: FastifyReply['raw'],
    next: () => void,
  ): void {
    const requested = request.headers['x-correlation-id'];
    const candidate = Array.isArray(requested) ? requested[0] : requested;
    const correlationId =
      candidate && validCorrelationId.test(candidate) ? candidate : randomUUID();

    response.setHeader('x-correlation-id', correlationId);
    requestContext.run({ correlationId }, next);
  }
}
