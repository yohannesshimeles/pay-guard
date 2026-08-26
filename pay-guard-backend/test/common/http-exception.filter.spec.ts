import {
  ArgumentsHost,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { HttpExceptionFilter } from '../../src/common/http-exception.filter';

type ErrorEnvelope = {
  message: string;
  error: {
    code: string;
    description: string;
    stackTrace?: string;
  };
};

describe('HttpExceptionFilter sensitive-data boundary', () => {
  const send = jest.fn<void, [ErrorEnvelope]>();
  const status = jest.fn(() => ({ send }));
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('redacts credential and account values from public 4xx messages', () => {
    new HttpExceptionFilter().catch(new BadRequestException(
      'password=private Bearer access-token accountNumber=100000001',
    ), host);

    const body = send.mock.calls[0]?.[0];
    expect(body.message).toBe(
      'password=[REDACTED] [REDACTED] accountNumber=[REDACTED]',
    );
    expect(body.error.code).toMatch(/^PG_REQUEST_/);
    expect(body.error.description).toBe(body.message);
    expect(body.error.stackTrace).toEqual(expect.any(String));
  });

  it('returns sanitized diagnostics in lower environments and logs only classification', () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    new HttpExceptionFilter().catch(
      new Error('password=private rawPayload=provider-body'), host,
    );

    const body = send.mock.calls[0]?.[0];
    expect(body.message).toBe('password=[REDACTED] rawPayload=[REDACTED]');
    expect(body.error.code).toMatch(/^PG_INTERNAL_/);
    expect(body.error.stackTrace).toEqual(expect.any(String));
    expect(JSON.stringify(logged.mock.calls)).not.toContain('private');
    expect(JSON.stringify(logged.mock.calls)).not.toContain('provider-body');
    logged.mockRestore();
  });

  it('hides internal descriptions and stack traces in production', () => {
    const prior = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    new HttpExceptionFilter().catch(new Error('internal database detail'), host);

    const body = send.mock.calls[0]?.[0];
    expect(body.message).toBe(
      'An unexpected server error occurred. Use the correlation ID when contacting support.',
    );
    expect(body.error.code).toMatch(/^PG_INTERNAL_/);
    expect(body.error.stackTrace).toBeUndefined();
    process.env.NODE_ENV = prior;
  });
});
