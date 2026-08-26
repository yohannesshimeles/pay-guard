import { loadConfig } from '../../src/config/app-config';

const validEnvironment = {
  NODE_ENV: 'test',
  PORT: '4100',
  LOG_LEVEL: 'error',
  DATABASE_SCHEMA_VERSION: 'legacy',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/payguard_test',
  REDIS_URL: 'redis://localhost:6379/1',
  JWT_ACCESS_SECRET: 'a-secure-test-secret-that-is-at-least-32-characters',
  JWT_ACCESS_TTL_SECONDS: '600',
  REFRESH_TOKEN_TTL_SECONDS: '1200',
  PASSWORD_RESET_TTL_SECONDS: '300',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'payguard-test',
  S3_ACCESS_KEY_ID: 'test-key',
  S3_SECRET_ACCESS_KEY: 'test-secret-at-least-sixteen',
  S3_FORCE_PATH_STYLE: 'true',
} satisfies NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('parses and maps valid environment configuration', () => {
    const config = loadConfig(validEnvironment);

    expect(config.port).toBe(4100);
    expect(config.environment).toBe('test');
    expect(config.trustProxyHops).toBe(0);
    expect(config.rateLimit).toEqual({
      enabled: true,
      windowMs: 60_000,
      globalMax: 300,
      authMax: 10,
      uploadMax: 20,
    });
    expect(config.databaseSchemaVersion).toBe('legacy');
    expect(config.databasePool).toEqual({
      max: 20,
      idleTimeoutMs: 30_000,
      connectionTimeoutMs: 5_000,
      queryTimeoutMs: 30_000,
      statementTimeoutMs: 30_000,
      keepAliveInitialDelayMs: 10_000,
      maxUses: 5_000,
      maxLifetimeSeconds: 1_800,
    });
    expect(config.clamav).toEqual({
      host: '127.0.0.1',
      port: 3_310,
      timeoutMs: 10_000,
      chunkBytes: 65_536,
    });
    expect(config.verifyEt).toEqual({
      enabled: false,
      baseUrl: undefined,
      apiKey: undefined,
      webhookUrl: undefined,
      webhookSecret: undefined,
      waitMs: 5_000,
      timeoutMs: 8_000,
      maxResponseBytes: 65_536,
      maxPollAttempts: 6,
      initialPollDelayMs: 2_000,
      maxPollDelayMs: 30_000,
    });
    expect(config.firebase).toEqual({
      enabled: false, projectId: undefined, clientEmail: undefined,
      privateKey: undefined, timeoutMs: 8_000,
    });
    expect(config.s3.forcePathStyle).toBe(true);
    expect(config.jwtAccessTtlSeconds).toBe(600);
    expect(config.archiveEncryptionKeyId).toBe('primary');
    expect(config.archivePreviousEncryptionKeys).toEqual({});
  });

  it('requires a complete Firebase service account only when enabled', () => {
    expect(() => loadConfig({
      ...validEnvironment, FIREBASE_ENABLED: 'true',
    })).toThrow('FIREBASE_PROJECT_ID');
  });

  it('requires a distinct account encryption key in production', () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        NODE_ENV: 'production',
        ACCOUNT_ENCRYPTION_KEY: validEnvironment.JWT_ACCESS_SECRET,
      }),
    ).toThrow('ACCOUNT_ENCRYPTION_KEY');
  });

  it('requires a separately managed archive encryption key in production', () => {
    expect(() => loadConfig({
      ...validEnvironment,
      NODE_ENV: 'production',
      ACCOUNT_ENCRYPTION_KEY:
        'account-encryption-key-that-is-at-least-32-characters',
      ARCHIVE_ENCRYPTION_KEY: validEnvironment.JWT_ACCESS_SECRET,
    })).toThrow('ARCHIVE_ENCRYPTION_KEY');
  });

  it('validates and maps the archive rotation keyring', () => {
    const config = loadConfig({ ...validEnvironment,
      ARCHIVE_ENCRYPTION_KEY_ID: '2026-q2',
      ARCHIVE_ENCRYPTION_KEY: 'new-archive-key-that-is-at-least-32-characters',
      ARCHIVE_PREVIOUS_ENCRYPTION_KEYS: JSON.stringify({
        '2026-q1': 'old-archive-key-that-is-at-least-32-characters',
      }) });
    expect(config.archiveEncryptionKeyId).toBe('2026-q2');
    expect(config.archivePreviousEncryptionKeys).toHaveProperty('2026-q1');
    expect(() => loadConfig({ ...validEnvironment,
      ARCHIVE_PREVIOUS_ENCRYPTION_KEYS: '{bad json' }))
      .toThrow('ARCHIVE_PREVIOUS_ENCRYPTION_KEYS');
  });

  it('rejects disabled production rate limiting and invalid proxy hops', () => {
    const productionSecrets = {
      ACCOUNT_ENCRYPTION_KEY:
        'account-encryption-key-that-is-at-least-32-characters',
      ARCHIVE_ENCRYPTION_KEY:
        'archive-encryption-key-that-is-at-least-32-characters',
      TRUST_PROXY_HOPS: '1',
    };
    expect(() => loadConfig({
      ...validEnvironment,
      ...productionSecrets,
      NODE_ENV: 'production',
      RATE_LIMIT_ENABLED: 'false',
    })).toThrow('RATE_LIMIT_ENABLED');
    expect(() => loadConfig({
      ...validEnvironment,
      TRUST_PROXY_HOPS: '6',
    })).toThrow('TRUST_PROXY_HOPS');
    expect(() => loadConfig({
      ...validEnvironment,
      ...productionSecrets,
      NODE_ENV: 'production',
      TRUST_PROXY_HOPS: undefined,
    })).toThrow('TRUST_PROXY_HOPS');
  });

  it('rejects short secrets without disclosing values', () => {
    expect(() =>
      loadConfig({ ...validEnvironment, JWT_ACCESS_SECRET: 'short' }),
    ).toThrow('Invalid application configuration');
  });

  it('rejects invalid service URLs', () => {
    expect(() =>
      loadConfig({ ...validEnvironment, DATABASE_URL: 'not-a-url' }),
    ).toThrow('DATABASE_URL');
  });

  it('validates database pool boundaries', () => {
    expect(() =>
      loadConfig({ ...validEnvironment, DATABASE_POOL_MAX: '0' }),
    ).toThrow('DATABASE_POOL_MAX');
  });

  it('requires isolated HTTPS Verify.ET credentials only when enabled', () => {
    expect(() =>
      loadConfig({ ...validEnvironment, VERIFYET_ENABLED: 'true' }),
    ).toThrow('VERIFYET_BASE_URL');

    expect(() =>
      loadConfig({
        ...validEnvironment,
        VERIFYET_ENABLED: 'true',
        VERIFYET_BASE_URL: 'http://verify-et.example.test',
        VERIFYET_API_KEY: 'verify-et-test-key-that-is-at-least-32-characters',
      }),
    ).toThrow('VERIFYET_BASE_URL');

    expect(() =>
      loadConfig({
        ...validEnvironment,
        VERIFYET_ENABLED: 'true',
        VERIFYET_BASE_URL: 'https://verify-et.example.test',
        VERIFYET_API_KEY: validEnvironment.JWT_ACCESS_SECRET,
      }),
    ).toThrow('VERIFYET_API_KEY');
  });

  it('maps enabled Verify.ET transport limits and its managed key', () => {
    const config = loadConfig({
      ...validEnvironment,
      VERIFYET_ENABLED: 'true',
      VERIFYET_BASE_URL: 'https://verify-et.example.test/api/',
      VERIFYET_API_KEY: 'verify-et-test-key-that-is-at-least-32-characters',
      VERIFYET_TIMEOUT_MS: '5000',
      VERIFYET_MAX_RESPONSE_BYTES: '32768',
      VERIFYET_MAX_POLL_ATTEMPTS: '8',
      VERIFYET_INITIAL_POLL_DELAY_MS: '1500',
      VERIFYET_MAX_POLL_DELAY_MS: '20000',
    });

    expect(config.verifyEt).toMatchObject({
      enabled: true,
      baseUrl: 'https://verify-et.example.test/api/',
      apiKey: 'verify-et-test-key-that-is-at-least-32-characters',
      timeoutMs: 5_000,
      maxResponseBytes: 32_768,
      maxPollAttempts: 8,
      initialPollDelayMs: 1_500,
      maxPollDelayMs: 20_000,
    });
  });

  it('validates Verify.ET polling boundaries', () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        VERIFYET_MAX_POLL_ATTEMPTS: '0',
      }),
    ).toThrow('VERIFYET_MAX_POLL_ATTEMPTS');
    expect(() =>
      loadConfig({
        ...validEnvironment,
        VERIFYET_INITIAL_POLL_DELAY_MS: '5000',
        VERIFYET_MAX_POLL_DELAY_MS: '1000',
      }),
    ).toThrow('VERIFYET_INITIAL_POLL_DELAY_MS');
  });
});
