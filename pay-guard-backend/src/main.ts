import './observability/tracing';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { AppModule } from './app.module';
import { configureApplication } from './bootstrap';
import { loadConfig } from './config/app-config';
import { DEFAULT_MAX_PROOF_BYTES } from './qr-processing/proof-file.validator';
import { resolvePublicError } from './common/error-contract';
import { nestLogLevels } from './common/nest-log-levels';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config),
    new FastifyAdapter({
      trustProxy: config.trustProxyHops ? config.trustProxyHops : false,
    }),
    {
      logger: nestLogLevels(config.logLevel),
      rawBody: true,
    },
  );
  await app.register(helmet);
  await app.register(multipart, {
    throwFileSizeLimit: true,
    limits: {
      fieldNameSize: 32,
      fieldSize: 0,
      fields: 0,
      fileSize: DEFAULT_MAX_PROOF_BYTES,
      files: 1,
      headerPairs: 50,
      parts: 1,
    },
  });
  app.enableShutdownHooks();
  configureApplication(app, {
    exposeDocumentation: config.environment !== 'production',
  });
  await app.listen(config.port, '0.0.0.0');
  Logger.log(
    JSON.stringify({
      event: 'application.started',
      port: config.port,
      environment: config.environment,
    }),
    'Bootstrap',
  );
}

void bootstrap().catch((error: unknown) => {
  Logger.error(
    JSON.stringify({
      event: 'application.start_failed',
      error: resolvePublicError(error, 500, undefined),
    }),
    'Bootstrap',
  );
  process.exitCode = 1;
});
