import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, AppConfig } from '../config/app-config';

@Injectable()
export class RedisService implements OnApplicationShutdown {
  readonly client: Redis;
  private connecting?: Promise<void>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
    });
  }

  async isReady(): Promise<boolean> {
    try {
      await this.ensureConnected();
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async ensureConnected(): Promise<void> {
    if (this.client.status === 'ready') return;
    if (this.connecting) {
      await this.connecting;
      return;
    }
    if (this.client.status !== 'wait') {
      throw new Error('Redis connection is unavailable');
    }
    this.connecting ??= this.client.connect().finally(() => {
      this.connecting = undefined;
    });
    await this.connecting;
  }

  onApplicationShutdown(): void {
    if (this.client.status !== 'end') this.client.disconnect();
  }
}
