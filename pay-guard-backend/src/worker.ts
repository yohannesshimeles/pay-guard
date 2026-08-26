import './observability/tracing';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadConfig } from './config/app-config';
import { WorkerModule } from './worker.module';
import { resolvePublicError } from './common/error-contract';
import { nestLogLevels } from './common/nest-log-levels';

async function bootstrapWorker(): Promise<void> {
  const config = loadConfig();
  const context = await NestFactory.createApplicationContext(
    WorkerModule.register(config),
    { logger: nestLogLevels(config.logLevel) },
  );
  context.enableShutdownHooks();
  Logger.log(
    JSON.stringify({
      event: 'worker.started',
      environment: config.environment,
    }),
    'WorkerBootstrap',
  );
}

void bootstrapWorker().catch((error: unknown) => {
  Logger.error(
    JSON.stringify({
      event: 'worker.start_failed',
      error: resolvePublicError(error, 500, undefined),
    }),
    'WorkerBootstrap',
  );
  process.exitCode = 1;
});
