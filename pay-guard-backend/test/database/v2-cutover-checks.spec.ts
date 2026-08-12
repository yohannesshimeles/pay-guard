import { validateCutoverEnvironment } from '../../src/database/v2-cutover-checks';

describe('V2 cutover environment checks', () => {
  const secureEnvironment = {
    NODE_ENV: 'test',
    DATABASE_SCHEMA_VERSION: 'v2',
    DATABASE_URL: 'postgresql://payguard:private@127.0.0.1:55432/payguard_v2',
    JWT_ACCESS_SECRET: 'jwt-secret-material-that-is-longer-than-thirty-two-characters',
    ACCOUNT_ENCRYPTION_KEY:
      'account-key-material-that-is-longer-than-thirty-two-characters',
    S3_ENDPOINT: 'http://127.0.0.1:9000',
  } satisfies NodeJS.ProcessEnv;

  it('accepts explicit V2 mode with separate non-placeholder secrets', () => {
    const checks = validateCutoverEnvironment(secureEnvironment);
    expect(checks.filter((check) => check.status === 'FAIL')).toEqual([]);
    expect(checks).toContainEqual(
      expect.objectContaining({
        name: 'Explicit V2 schema mode',
        status: 'PASS',
      }),
    );
  });

  it('rejects legacy mode, placeholder secrets, and reused keys', () => {
    const checks = validateCutoverEnvironment({
      ...secureEnvironment,
      DATABASE_SCHEMA_VERSION: 'legacy',
      JWT_ACCESS_SECRET: 'replace-with-at-least-32-random-characters',
      ACCOUNT_ENCRYPTION_KEY: 'replace-with-at-least-32-random-characters',
    });
    expect(checks.filter((check) => check.status === 'FAIL').length).toBeGreaterThanOrEqual(4);
  });

  it('requires TLS database and object-storage endpoints in production', () => {
    const checks = validateCutoverEnvironment({
      ...secureEnvironment,
      NODE_ENV: 'production',
    });
    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Production database transport security',
          status: 'FAIL',
        }),
        expect.objectContaining({
          name: 'Production object-storage transport security',
          status: 'FAIL',
        }),
      ]),
    );
  });
});
