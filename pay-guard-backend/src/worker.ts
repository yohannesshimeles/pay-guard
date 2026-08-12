import './observability/tracing';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadConfig } from './config/app-config';
import { WorkerModule } from './worker.module';

async function bootstrapWorker(): Promise<void> {
  const config = loadConfig();
  const context = await NestFactory.createApplicationContext(
    WorkerModule.register(config),
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
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  Logger.error(
    JSON.stringify({ event: 'worker.start_failed', message }),
    'WorkerBootstrap',
  );
  process.exitCode = 1;
});
