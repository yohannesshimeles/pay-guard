import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false'])
  .default('true')
  .transform((value) => value === 'true');

const disabledBooleanFromString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const schema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).optional(),
    RATE_LIMIT_ENABLED: booleanFromString,
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000)
      .default(60_000),
    RATE_LIMIT_GLOBAL_MAX: z.coerce.number().int().min(1).max(100_000)
      .default(300),
    RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(1).max(10_000)
      .default(10),
    RATE_LIMIT_UPLOAD_MAX: z.coerce.number().int().min(1).max(10_000)
      .default(20),
    DATABASE_SCHEMA_VERSION: z.enum(['legacy', 'v2']).default('legacy'),
    DATABASE_URL: z.string().url(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(20),
    DATABASE_IDLE_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .default(30_000),
    DATABASE_CONNECTION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .default(5_000),
    DATABASE_QUERY_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .default(30_000),
    DATABASE_STATEMENT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .default(30_000),
    DATABASE_KEEPALIVE_INITIAL_DELAY_MS: z.coerce
      .number()
      .int()
      .min(0)
      .default(10_000),
    DATABASE_MAX_USES: z.coerce.number().int().min(1).default(5_000),
    DATABASE_MAX_LIFETIME_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .default(1_800),
    CLAMAV_HOST: z.string().min(1).default('127.0.0.1'),
    CLAMAV_PORT: z.coerce.number().int().min(1).max(65_535).default(3_310),
    CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(100).default(10_000),
    CLAMAV_CHUNK_BYTES: z.coerce
      .number()
      .int()
      .min(1_024)
      .max(1_048_576)
      .default(65_536),
    VERIFYET_ENABLED: disabledBooleanFromString,
    VERIFYET_BASE_URL: z.string().url().optional(),
    VERIFYET_API_KEY: z.string().min(32).optional(),
    VERIFYET_WEBHOOK_URL: z.string().url().optional(),
    VERIFYET_WEBHOOK_SECRET: z.string().min(32).optional(),
    VERIFYET_WAIT_MS: z.coerce.number().int().min(0).max(30_000)
      .default(5_000),
    VERIFYET_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(500)
      .max(30_000)
      .default(8_000),
    VERIFYET_MAX_RESPONSE_BYTES: z.coerce
      .number()
      .int()
      .min(1_024)
      .max(1_048_576)
      .default(65_536),
    VERIFYET_MAX_POLL_ATTEMPTS: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .default(6),
    VERIFYET_INITIAL_POLL_DELAY_MS: z.coerce
      .number()
      .int()
      .min(500)
      .max(60_000)
      .default(2_000),
    VERIFYET_MAX_POLL_DELAY_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(300_000)
      .default(30_000),
    FIREBASE_ENABLED: disabledBooleanFromString,
    FIREBASE_PROJECT_ID: z.string().min(1).optional(),
    FIREBASE_CLIENT_EMAIL: z.string().email().optional(),
    FIREBASE_PRIVATE_KEY: z.string().min(64).optional(),
    FIREBASE_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000)
      .default(8_000),
    NOTIFICATION_WORKER_POLL_MS: z.coerce.number().int().min(250).max(60_000)
      .default(2_000),
    REDIS_URL: z.string().url(),
    JWT_ACCESS_SECRET: z.string().min(32),
    ACCOUNT_ENCRYPTION_KEY: z.string().min(32).optional(),
    ARCHIVE_ENCRYPTION_KEY: z.string().min(32).optional(),
    ARCHIVE_ENCRYPTION_KEY_ID: z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/)
      .default('primary'),
    ARCHIVE_PREVIOUS_ENCRYPTION_KEYS: z.string().default('{}'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(2_592_000),
    PASSWORD_RESET_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(1_800),
    S3_ENDPOINT: z.string().url(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(16),
    S3_FORCE_PATH_STYLE: booleanFromString,
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  })
  .superRefine((value, context) => {
    if (
      value.NODE_ENV === 'production' &&
      (!value.ACCOUNT_ENCRYPTION_KEY ||
        value.ACCOUNT_ENCRYPTION_KEY === value.JWT_ACCESS_SECRET)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['ACCOUNT_ENCRYPTION_KEY'],
        message: 'A distinct account encryption key is required in production',
      });
    }
    if (value.NODE_ENV === 'production' && !value.RATE_LIMIT_ENABLED) {
      context.addIssue({
        code: 'custom',
        path: ['RATE_LIMIT_ENABLED'],
        message: 'Application rate limiting cannot be disabled in production',
      });
    }
    if (value.NODE_ENV === 'production' && value.TRUST_PROXY_HOPS === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['TRUST_PROXY_HOPS'],
        message: 'Production proxy trust must use an explicit hop count',
      });
    }
    if (
      value.NODE_ENV === 'production' &&
      (!value.ARCHIVE_ENCRYPTION_KEY ||
        [value.JWT_ACCESS_SECRET, value.ACCOUNT_ENCRYPTION_KEY,
          value.S3_SECRET_ACCESS_KEY].includes(value.ARCHIVE_ENCRYPTION_KEY))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['ARCHIVE_ENCRYPTION_KEY'],
        message: 'A distinct archive encryption key is required in production',
      });
    }
    if (value.VERIFYET_ENABLED) {
      if (!value.VERIFYET_BASE_URL) {
        context.addIssue({
          code: 'custom',
          path: ['VERIFYET_BASE_URL'],
          message: 'Verify.ET base URL is required when enabled',
        });
      } else {
        const url = new URL(value.VERIFYET_BASE_URL);
        if (
          url.protocol !== 'https:' ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        ) {
          context.addIssue({
            code: 'custom',
            path: ['VERIFYET_BASE_URL'],
            message:
              'Verify.ET base URL must be HTTPS without credentials, query or fragment',
          });
        }
      }
      if (!value.VERIFYET_API_KEY) {
        context.addIssue({
          code: 'custom',
          path: ['VERIFYET_API_KEY'],
          message: 'Verify.ET API key is required when enabled',
        });
      } else if (
        value.VERIFYET_API_KEY === value.JWT_ACCESS_SECRET ||
        value.VERIFYET_API_KEY === value.ACCOUNT_ENCRYPTION_KEY ||
        value.VERIFYET_API_KEY === value.S3_SECRET_ACCESS_KEY
      ) {
        context.addIssue({
          code: 'custom',
          path: ['VERIFYET_API_KEY'],
          message: 'Verify.ET API key must be a distinct secret',
        });
      }
      if (value.VERIFYET_WEBHOOK_URL) {
        const webhookUrl = new URL(value.VERIFYET_WEBHOOK_URL);
        if (
          (value.NODE_ENV === 'production' && webhookUrl.protocol !== 'https:') ||
          !['http:', 'https:'].includes(webhookUrl.protocol) ||
          webhookUrl.username ||
          webhookUrl.password ||
          webhookUrl.hash
        ) {
          context.addIssue({
            code: 'custom',
            path: ['VERIFYET_WEBHOOK_URL'],
            message: 'Verify.ET webhook URL must be a safe HTTP(S) URL and HTTPS in production',
          });
        }
        if (!value.VERIFYET_WEBHOOK_SECRET) {
          context.addIssue({
            code: 'custom',
            path: ['VERIFYET_WEBHOOK_SECRET'],
            message: 'Verify.ET webhook secret is required when webhook delivery is enabled',
          });
        }
      }
    }
    if (
      value.VERIFYET_INITIAL_POLL_DELAY_MS > value.VERIFYET_MAX_POLL_DELAY_MS
    ) {
      context.addIssue({
        code: 'custom',
        path: ['VERIFYET_INITIAL_POLL_DELAY_MS'],
        message: 'Verify.ET initial poll delay cannot exceed its maximum',
      });
    }
    if (value.FIREBASE_ENABLED) {
      for (const [path, configured] of [
        ['FIREBASE_PROJECT_ID', value.FIREBASE_PROJECT_ID],
        ['FIREBASE_CLIENT_EMAIL', value.FIREBASE_CLIENT_EMAIL],
        ['FIREBASE_PRIVATE_KEY', value.FIREBASE_PRIVATE_KEY],
      ] as const) {
        if (!configured) context.addIssue({
          code: 'custom', path: [path],
          message: `${path} is required when Firebase is enabled`,
        });
      }
    }
  });

export type AppConfig = {
  environment: 'development' | 'test' | 'production';
  port: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  trustProxyHops?: number;
  rateLimit?: {
    enabled: boolean;
    windowMs: number;
    globalMax: number;
    authMax: number;
    uploadMax: number;
  };
  databaseSchemaVersion: 'legacy' | 'v2';
  databaseUrl: string;
  databasePool: {
    max: number;
    idleTimeoutMs: number;
    connectionTimeoutMs: number;
    queryTimeoutMs: number;
    statementTimeoutMs: number;
    keepAliveInitialDelayMs: number;
    maxUses: number;
    maxLifetimeSeconds: number;
  };
  clamav: {
    host: string;
    port: number;
    timeoutMs: number;
    chunkBytes: number;
  };
  verifyEt: {
    enabled: boolean;
    baseUrl?: string;
    apiKey?: string;
    webhookUrl?: string;
    webhookSecret?: string;
    waitMs: number;
    timeoutMs: number;
    maxResponseBytes: number;
    maxPollAttempts: number;
    initialPollDelayMs: number;
    maxPollDelayMs: number;
  };
  firebase: {
    enabled: boolean;
    projectId?: string;
    clientEmail?: string;
    privateKey?: string;
    timeoutMs: number;
  };
  notificationWorkerPollMs: number;
  redisUrl: string;
  jwtAccessSecret: string;
  accountEncryptionKey?: string;
  archiveEncryptionKey?: string;
  archiveEncryptionKeyId?: string;
  archivePreviousEncryptionKeys?: Readonly<Record<string, string>>;
  jwtAccessTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  passwordResetTtlSeconds: number;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  };
  otelEndpoint?: string;
};

export const DEFAULT_DATABASE_POOL_CONFIG: AppConfig['databasePool'] = {
  max: 20,
  idleTimeoutMs: 30_000,
  connectionTimeoutMs: 5_000,
  queryTimeoutMs: 30_000,
  statementTimeoutMs: 30_000,
  keepAliveInitialDelayMs: 10_000,
  maxUses: 5_000,
  maxLifetimeSeconds: 1_800,
};

export const DEFAULT_CLAMAV_CONFIG: AppConfig['clamav'] = {
  host: '127.0.0.1',
  port: 3_310,
  timeoutMs: 10_000,
  chunkBytes: 65_536,
};

export const DEFAULT_VERIFYET_CONFIG: AppConfig['verifyEt'] = {
  enabled: false,
  waitMs: 5_000,
  timeoutMs: 8_000,
  maxResponseBytes: 65_536,
  maxPollAttempts: 6,
  initialPollDelayMs: 2_000,
  maxPollDelayMs: 30_000,
};

export const DEFAULT_FIREBASE_CONFIG: AppConfig['firebase'] = {
  enabled: false,
  timeoutMs: 8_000,
};

export const DEFAULT_RATE_LIMIT_CONFIG: NonNullable<AppConfig['rateLimit']> = {
  enabled: true,
  windowMs: 60_000,
  globalMax: 300,
  authMax: 10,
  uploadMax: 20,
};

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const parsed = schema.safeParse(environment);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid application configuration: ${details}`);
  }
  const archivePreviousEncryptionKeys = parseArchivePreviousKeys(
    parsed.data.ARCHIVE_PREVIOUS_ENCRYPTION_KEYS,
  );
  if (parsed.data.ARCHIVE_ENCRYPTION_KEY_ID in archivePreviousEncryptionKeys) {
    throw new Error(
      'Invalid application configuration: ARCHIVE_PREVIOUS_ENCRYPTION_KEYS: current key id cannot also be previous',
    );
  }
  if (parsed.data.ARCHIVE_ENCRYPTION_KEY && Object.values(
    archivePreviousEncryptionKeys,
  ).includes(parsed.data.ARCHIVE_ENCRYPTION_KEY)) {
    throw new Error(
      'Invalid application configuration: ARCHIVE_PREVIOUS_ENCRYPTION_KEYS: current key cannot also be previous',
    );
  }

  return {
    environment: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    logLevel: parsed.data.LOG_LEVEL,
    trustProxyHops: parsed.data.TRUST_PROXY_HOPS ?? 0,
    rateLimit: {
      enabled: parsed.data.RATE_LIMIT_ENABLED,
      windowMs: parsed.data.RATE_LIMIT_WINDOW_MS,
      globalMax: parsed.data.RATE_LIMIT_GLOBAL_MAX,
      authMax: parsed.data.RATE_LIMIT_AUTH_MAX,
      uploadMax: parsed.data.RATE_LIMIT_UPLOAD_MAX,
    },
    databaseSchemaVersion: parsed.data.DATABASE_SCHEMA_VERSION,
    databaseUrl: parsed.data.DATABASE_URL,
    databasePool: {
      max: parsed.data.DATABASE_POOL_MAX,
      idleTimeoutMs: parsed.data.DATABASE_IDLE_TIMEOUT_MS,
      connectionTimeoutMs: parsed.data.DATABASE_CONNECTION_TIMEOUT_MS,
      queryTimeoutMs: parsed.data.DATABASE_QUERY_TIMEOUT_MS,
      statementTimeoutMs: parsed.data.DATABASE_STATEMENT_TIMEOUT_MS,
      keepAliveInitialDelayMs: parsed.data.DATABASE_KEEPALIVE_INITIAL_DELAY_MS,
      maxUses: parsed.data.DATABASE_MAX_USES,
      maxLifetimeSeconds: parsed.data.DATABASE_MAX_LIFETIME_SECONDS,
    },
    clamav: {
      host: parsed.data.CLAMAV_HOST,
      port: parsed.data.CLAMAV_PORT,
      timeoutMs: parsed.data.CLAMAV_TIMEOUT_MS,
      chunkBytes: parsed.data.CLAMAV_CHUNK_BYTES,
    },
    verifyEt: {
      enabled: parsed.data.VERIFYET_ENABLED,
      baseUrl: parsed.data.VERIFYET_BASE_URL,
      apiKey: parsed.data.VERIFYET_API_KEY,
      webhookUrl: parsed.data.VERIFYET_WEBHOOK_URL,
      webhookSecret: parsed.data.VERIFYET_WEBHOOK_SECRET,
      waitMs: parsed.data.VERIFYET_WAIT_MS,
      timeoutMs: parsed.data.VERIFYET_TIMEOUT_MS,
      maxResponseBytes: parsed.data.VERIFYET_MAX_RESPONSE_BYTES,
      maxPollAttempts: parsed.data.VERIFYET_MAX_POLL_ATTEMPTS,
      initialPollDelayMs: parsed.data.VERIFYET_INITIAL_POLL_DELAY_MS,
      maxPollDelayMs: parsed.data.VERIFYET_MAX_POLL_DELAY_MS,
    },
    firebase: {
      enabled: parsed.data.FIREBASE_ENABLED,
      projectId: parsed.data.FIREBASE_PROJECT_ID,
      clientEmail: parsed.data.FIREBASE_CLIENT_EMAIL,
      privateKey: parsed.data.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      timeoutMs: parsed.data.FIREBASE_TIMEOUT_MS,
    },
    notificationWorkerPollMs: parsed.data.NOTIFICATION_WORKER_POLL_MS,
    redisUrl: parsed.data.REDIS_URL,
    jwtAccessSecret: parsed.data.JWT_ACCESS_SECRET,
    accountEncryptionKey:
      parsed.data.ACCOUNT_ENCRYPTION_KEY ?? parsed.data.JWT_ACCESS_SECRET,
    archiveEncryptionKey:
      parsed.data.ARCHIVE_ENCRYPTION_KEY ??
      parsed.data.ACCOUNT_ENCRYPTION_KEY ?? parsed.data.JWT_ACCESS_SECRET,
    archiveEncryptionKeyId: parsed.data.ARCHIVE_ENCRYPTION_KEY_ID,
    archivePreviousEncryptionKeys,
    jwtAccessTtlSeconds: parsed.data.JWT_ACCESS_TTL_SECONDS,
    refreshTokenTtlSeconds: parsed.data.REFRESH_TOKEN_TTL_SECONDS,
    passwordResetTtlSeconds: parsed.data.PASSWORD_RESET_TTL_SECONDS,
    s3: {
      endpoint: parsed.data.S3_ENDPOINT,
      region: parsed.data.S3_REGION,
      bucket: parsed.data.S3_BUCKET,
      accessKeyId: parsed.data.S3_ACCESS_KEY_ID,
      secretAccessKey: parsed.data.S3_SECRET_ACCESS_KEY,
      forcePathStyle: parsed.data.S3_FORCE_PATH_STYLE,
    },
    otelEndpoint: parsed.data.OTEL_EXPORTER_OTLP_ENDPOINT,
  };
}

function parseArchivePreviousKeys(raw: string): Readonly<Record<string, string>> {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const entries = Object.entries(value);
    if (entries.some(([id, secret]) =>
      !/^[a-zA-Z0-9._-]{1,64}$/.test(id) ||
      typeof secret !== 'string' || secret.length < 32)) throw new Error();
    return Object.fromEntries(entries);
  } catch {
    throw new Error(
      'Invalid application configuration: ARCHIVE_PREVIOUS_ENCRYPTION_KEYS must be a JSON object of key ids to 32+ character secrets',
    );
  }
}
