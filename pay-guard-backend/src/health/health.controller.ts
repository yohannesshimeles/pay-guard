import { Controller, Get, Inject, Res } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { DatabaseService } from '../database/database.service';
import { MetricsService } from '../observability/metrics.service';
import { RedisService } from '../redis/redis.service';
import {
  OBJECT_STORAGE,
  ObjectStoragePort,
} from '../storage/object-storage.port';

@Controller()
export class HealthController {
  constructor(
    private readonly database: DatabaseService,
    private readonly redis: RedisService,
    private readonly metrics: MetricsService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
  ) {}

  @Get('health/live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('health/ready')
  async ready(@Res({ passthrough: true }) response: FastifyReply) {
    const [database, redis, storage] = await Promise.all([
      this.database.isReady(),
      this.redis.isReady(),
      this.storage.isReady(),
    ]);
    const ready = database && redis && storage;
    response.status(ready ? 200 : 503);
    return { status: ready ? 'ready' : 'not_ready', database, redis, storage };
  }

  @Get('metrics')
  async getMetrics(@Res({ passthrough: true }) response: FastifyReply): Promise<string> {
    response.header('content-type', this.metrics.registry.contentType);
    return this.metrics.registry.metrics();
  }
}
