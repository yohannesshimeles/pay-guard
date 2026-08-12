import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';

function redisConnection(config: AppConfig) {
  const url = new URL(config.redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    tls: url.protocol === 'rediss:' ? {} : undefined,
  };
}

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        connection: redisConnection(config),
        prefix: 'payguard',
      }),
    }),
    BullModule.registerQueue({ name: 'system-jobs' }),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
