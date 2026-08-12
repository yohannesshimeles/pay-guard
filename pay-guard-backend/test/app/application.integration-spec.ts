import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from '../../src/app.module';
import { configureApplication } from '../../src/bootstrap';
import {
  AppConfig,
  DEFAULT_CLAMAV_CONFIG,
  DEFAULT_DATABASE_POOL_CONFIG,
  DEFAULT_VERIFYET_CONFIG,
} from '../../src/config/app-config';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('application bootstrap', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const config: AppConfig = {
      environment: 'test',
      port: 0,
      logLevel: 'error',
      databaseSchemaVersion: 'legacy',
      databaseUrl: databaseUrl!,
      databasePool: DEFAULT_DATABASE_POOL_CONFIG,
      clamav: DEFAULT_CLAMAV_CONFIG,
      verifyEt: DEFAULT_VERIFYET_CONFIG,
      redisUrl: 'redis://127.0.0.1:6399',
      jwtAccessSecret: 'test-secret-that-is-longer-than-thirty-two-characters',
      jwtAccessTtlSeconds: 900,
      refreshTokenTtlSeconds: 3600,
      passwordResetTtlSeconds: 300,
      s3: {
        endpoint: 'http://127.0.0.1:9199',
        region: 'us-east-1',
        bucket: 'payguard-test',
        accessKeyId: 'test',
        secretAccessKey: 'test-secret-at-least-sixteen',
        forcePathStyle: true,
      },
    };
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule.register(config),
      new FastifyAdapter(),
      { logger: false },
    );
    configureApplication(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves liveness independently of external dependencies', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: { status: 'ok' },
    });
  });

  it('reports not ready when Redis and object storage are unavailable', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        status: 'not_ready',
        database: true,
        redis: false,
        storage: false,
      },
    });
  });
});
