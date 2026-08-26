import { HttpException, HttpStatus } from '@nestjs/common';
import { sanitizeSensitiveText } from './sensitive-data-sanitizer';

export type ErrorDetails = string[] | Record<string, unknown>;

export type PublicErrorDefinition = {
  code: string;
  description: string;
  details?: ErrorDetails;
  stackTrace?: string;
};

type ErrorLike = Error & { code?: unknown };

const DATABASE_ERRORS: Readonly<Record<string, Omit<PublicErrorDefinition, 'stackTrace'>>> = {
  '3D000': {
    code: 'PG_DATABASE_INVALID_CATALOG',
    description: 'The configured PostgreSQL database does not exist or cannot be opened.',
  },
  '23503': {
    code: 'PG_DATABASE_FOREIGN_KEY_VIOLATION',
    description: 'The operation references a related record that does not exist or is still in use.',
  },
  '23505': {
    code: 'PG_DATABASE_UNIQUE_CONSTRAINT_VIOLATION',
    description: 'The operation conflicts with an existing unique record.',
  },
  '23514': {
    code: 'PG_DATABASE_CHECK_CONSTRAINT_VIOLATION',
    description: 'The supplied data violates a database integrity rule.',
  },
  '40001': {
    code: 'PG_DATABASE_SERIALIZATION_FAILURE',
    description: 'The transaction could not be serialized and may be retried.',
  },
  '40P01': {
    code: 'PG_DATABASE_DEADLOCK',
    description: 'The transaction was cancelled after a database deadlock and may be retried.',
  },
  '57014': {
    code: 'PG_DATABASE_QUERY_CANCELLED',
    description: 'The database operation exceeded its configured deadline or was cancelled.',
  },
  '08001': {
    code: 'PG_DATABASE_CONNECTION_FAILED',
    description: 'The application could not establish a PostgreSQL connection.',
  },
  '08006': {
    code: 'PG_DATABASE_CONNECTION_LOST',
    description: 'The PostgreSQL connection was lost while processing the request.',
  },
};

const STATUS_DOMAINS: Readonly<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'AUTHENTICATION',
  [HttpStatus.FORBIDDEN]: 'AUTHORIZATION',
  [HttpStatus.NOT_FOUND]: 'RESOURCE',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'UPLOAD',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'VALIDATION',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMIT',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'DEPENDENCY',
};

export function resolvePublicError(
  exception: unknown,
  status: number,
  rawResponse: unknown,
  environment = process.env.NODE_ENV ?? 'development',
): PublicErrorDefinition {
  const explicit = explicitDefinition(rawResponse);
  const database = databaseDefinition(exception);
  const validationMessages = responseMessages(rawResponse);
  const isProduction = environment === 'production';
  const internal = status >= 500;
  const safeExceptionMessage = exception instanceof Error
    ? sanitizeSensitiveText(exception.message)
    : undefined;
  const description = explicit?.description
    ?? database?.description
    ?? (internal && isProduction
      ? 'An unexpected server error occurred. Use the correlation ID when contacting support.'
      : validationMessages.length > 1
        ? 'One or more request fields failed validation.'
        : validationMessages[0]
          ?? safeExceptionMessage
          ?? 'The request could not be completed.');
  const code = explicit?.code
    ?? database?.code
    ?? generatedErrorCode(
      status,
      exception,
      description,
      internal ? internalFingerprint(exception) : description,
    );
  const details = explicit?.details
    ?? (validationMessages.length > 1 ? validationMessages : undefined);

  return {
    code,
    description,
    details,
    stackTrace: !isProduction && exception instanceof Error
      ? sanitizeSensitiveText(exception.stack ?? `${exception.name}: ${exception.message}`)
      : undefined,
  };
}

function explicitDefinition(raw: unknown): Omit<PublicErrorDefinition, 'stackTrace'> | undefined {
  if (!isRecord(raw)) return undefined;
  const nested = isRecord(raw.error) ? raw.error : raw;
  if (typeof nested.code !== 'string' || !/^PG_[A-Z0-9_]+$/u.test(nested.code)) {
    return undefined;
  }
  const description = typeof nested.description === 'string'
    ? sanitizeSensitiveText(nested.description)
    : responseMessages(raw)[0] ?? 'The request could not be completed.';
  const details = normalizeDetails(nested.details);
  return { code: nested.code, description, details };
}

function databaseDefinition(
  exception: unknown,
): Omit<PublicErrorDefinition, 'stackTrace'> | undefined {
  if (!(exception instanceof Error)) return undefined;
  const code = (exception as ErrorLike).code;
  return typeof code === 'string' ? DATABASE_ERRORS[code] : undefined;
}

function responseMessages(raw: unknown): string[] {
  if (!isRecord(raw) || !('message' in raw)) return [];
  const message = raw.message;
  const values = Array.isArray(message) ? message : [message];
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => sanitizeSensitiveText(value));
}

function normalizeDetails(value: unknown): ErrorDetails | undefined {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSensitiveText(String(item)));
  }
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      typeof item === 'string' ? sanitizeSensitiveText(item) : item,
    ]),
  );
}

function generatedErrorCode(
  status: number,
  exception: unknown,
  description: string,
  fingerprint: string,
): string {
  const domain = STATUS_DOMAINS[status] ?? (status >= 500 ? 'INTERNAL' : `HTTP_${status}`);
  const semantic = description
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, 48) || 'REQUEST_FAILED';
  const errorName = exception instanceof Error ? exception.name : 'UnknownError';
  const hash = fnv1a(`${status}:${errorName}:${fingerprint}`);
  return `PG_${domain}_${semantic}_${hash}`;
}

function internalFingerprint(exception: unknown): string {
  if (!(exception instanceof Error)) return 'unknown-internal-error';
  const stackPoint = exception.stack
    ?.split(/\r?\n/u)
    .slice(1)
    .map((line) => line.trim())
    .find((line) => !line.includes('node:internal'));
  return `${exception.name}:${stackPoint ?? exception.message}`;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class CodedHttpException extends HttpException {
  constructor(
    status: HttpStatus,
    definition: Omit<PublicErrorDefinition, 'stackTrace'>,
    options?: { cause?: unknown },
  ) {
    super({
      message: definition.description,
      error: definition,
    }, status, options);
  }
}
