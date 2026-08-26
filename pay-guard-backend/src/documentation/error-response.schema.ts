import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiErrorDetailSchema {
  @ApiProperty({
    example: 'PG_AUTHENTICATION_INVALID_CREDENTIALS_5A7D13C4',
    description: 'Stable, unique PayGuard error code suitable for client branching and support searches.',
  })
  code!: string;

  @ApiProperty({
    example: 'Invalid credentials',
    description: 'Safe human-readable explanation of the failure.',
  })
  description!: string;

  @ApiPropertyOptional({
    description: 'Validation messages or safe structured context. Never contains credentials or raw provider payloads.',
    oneOf: [
      { type: 'array', items: { type: 'string' } },
      { type: 'object', additionalProperties: true },
    ],
  })
  details?: string[] | Record<string, unknown>;

  @ApiPropertyOptional({
    example: 'UnauthorizedException: Invalid credentials\n    at AuthService.login (...)',
    description: 'Sanitized stack trace. Present only when NODE_ENV is not production.',
  })
  stackTrace?: string;
}

export class ApiErrorResponseSchema {
  @ApiProperty({ example: false })
  success!: false;

  @ApiProperty({ example: 'Invalid credentials' })
  message!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: false,
    nullable: true,
    example: null,
  })
  data!: null;

  @ApiProperty({ type: ApiErrorDetailSchema })
  error!: ApiErrorDetailSchema;

  @ApiProperty({
    example: '4328d00e-0c78-4413-8b3f-b1f92268569f',
    description: 'Request correlation ID echoed in the x-correlation-id response header.',
  })
  correlationId!: string;
}
