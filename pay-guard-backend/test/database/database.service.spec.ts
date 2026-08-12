import {
  databaseErrorCode,
  isDatabaseConnectionError,
} from '../../src/database/database.service';

describe('database connection error classification', () => {
  it.each(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', '08006', '57P01'])(
    'classifies %s as a broken connection',
    (code) => {
      expect(isDatabaseConnectionError({ code })).toBe(true);
    },
  );

  it.each(['23505', '23503', '40001', undefined])(
    'does not classify %s as a broken connection',
    (code) => {
      expect(isDatabaseConnectionError(code ? { code } : new Error('failure'))).toBe(
        false,
      );
    },
  );

  it('extracts only string error codes', () => {
    expect(databaseErrorCode({ code: 'ECONNRESET' })).toBe('ECONNRESET');
    expect(databaseErrorCode({ code: 500 })).toBeUndefined();
    expect(databaseErrorCode('ECONNRESET')).toBeUndefined();
  });
});
