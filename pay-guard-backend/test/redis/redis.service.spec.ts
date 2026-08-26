import { AppConfig } from '../../src/config/app-config';
import { RedisService } from '../../src/redis/redis.service';

describe('RedisService', () => {
  it('shares one lazy connection attempt across concurrent consumers', async () => {
    const redis = new RedisService({ redisUrl: 'redis://localhost:6379' } as AppConfig);
    const client = redis.client as unknown as {
      status: string; connect: jest.Mock<Promise<void>, []>;
    };
    Object.defineProperty(client, 'status', { configurable: true, get: () => 'wait' });
    let release: (() => void) | undefined;
    client.connect = jest.fn(() => new Promise<void>((resolve) => { release = resolve; }));

    const attempts = [redis.ensureConnected(), redis.ensureConnected(),
      redis.ensureConnected()];
    expect(client.connect).toHaveBeenCalledTimes(1);
    release?.();
    await expect(Promise.all(attempts)).resolves.toEqual([undefined, undefined, undefined]);
  });
});
