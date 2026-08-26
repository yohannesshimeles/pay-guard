import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Logger,
} from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { requestContext } from '../../src/common/request-context';
import { RequestLoggingInterceptor } from '../../src/observability/request-logging.interceptor';

function parseLogRecord(value: unknown): Record<string, unknown> {
  const parsed: unknown = JSON.parse(String(value));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected structured log object');
  }
  return parsed as Record<string, unknown>;
}

describe('RequestLoggingInterceptor', () => {
  const interceptor = new RequestLoggingInterceptor();
  const request = {
    method: 'POST',
    url: '/api/v1/auth/login?password=private&accountNumber=100000001',
    headers: { authorization: 'Bearer private-token' },
    body: { password: 'private', rawPayload: 'provider-body' },
    routeOptions: { url: '/api/v1/auth/login' },
  };
  const response = { statusCode: 201 };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;

  afterEach(() => jest.restoreAllMocks());

  it('logs a correlated route template without request secrets', async () => {
    const logged = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const next = { handle: () => of({ ok: true }) } as CallHandler;

    await requestContext.run(
      { correlationId: 'structured-log-test-1234' },
      () => lastValueFrom(interceptor.intercept(context, next)),
    );

    const record = parseLogRecord(logged.mock.calls[0]?.[0]);
    expect(record).toMatchObject({
      event: 'request.completed',
      correlationId: 'structured-log-test-1234',
      method: 'POST',
      route: '/api/v1/auth/login',
      status: 201,
      outcome: 'SUCCESS',
    });
    expect(record.durationMs).toEqual(expect.any(Number));
    const serialized = JSON.stringify(logged.mock.calls);
    expect(serialized).not.toContain('private-token');
    expect(serialized).not.toContain('provider-body');
    expect(serialized).not.toContain('100000001');
  });

  it('classifies an HTTP failure without logging its message', async () => {
    const warned = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const next = {
      handle: () => throwError(() => new BadRequestException(
        'password=private rawPayload=provider-body',
      )),
    } as CallHandler;

    await expect(requestContext.run(
      { correlationId: 'structured-log-error-1234' },
      () => lastValueFrom(interceptor.intercept(context, next)),
    )).rejects.toBeInstanceOf(BadRequestException);

    const record = parseLogRecord(warned.mock.calls[0]?.[0]);
    expect(record).toMatchObject({
      correlationId: 'structured-log-error-1234',
      status: 400,
      outcome: 'CLIENT_ERROR',
    });
    expect(JSON.stringify(warned.mock.calls)).not.toContain('provider-body');
    expect(JSON.stringify(warned.mock.calls)).not.toContain('private');
  });
});
