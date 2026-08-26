import { BadRequestException } from '@nestjs/common';
import { resolvePublicError } from '../../src/common/error-contract';

describe('error contract', () => {
  it('creates deterministic unique codes for existing HTTP throw sites', () => {
    const first = resolvePublicError(
      new BadRequestException('dateFrom must not be after dateTo'), 400,
      { message: 'dateFrom must not be after dateTo' }, 'test',
    );
    const repeated = resolvePublicError(
      new BadRequestException('dateFrom must not be after dateTo'), 400,
      { message: 'dateFrom must not be after dateTo' }, 'test',
    );
    const different = resolvePublicError(
      new BadRequestException('Future transaction dates are not permitted'), 400,
      { message: 'Future transaction dates are not permitted' }, 'test',
    );

    expect(first.code).toBe(repeated.code);
    expect(first.code).not.toBe(different.code);
    expect(first.description).toBe('dateFrom must not be after dateTo');
  });

  it('maps PostgreSQL failures to documented codes', () => {
    const error = Object.assign(new Error('database does not exist'), { code: '3D000' });
    expect(resolvePublicError(error, 500, undefined, 'production')).toEqual({
      code: 'PG_DATABASE_INVALID_CATALOG',
      description: 'The configured PostgreSQL database does not exist or cannot be opened.',
      details: undefined,
      stackTrace: undefined,
    });
  });

  it('keeps validation details structured', () => {
    const error = new BadRequestException(['email must be valid', 'name is required']);
    expect(resolvePublicError(error, 400, error.getResponse(), 'test')).toEqual(
      expect.objectContaining({
        description: 'One or more request fields failed validation.',
        details: ['email must be valid', 'name is required'],
      }),
    );
  });
});
