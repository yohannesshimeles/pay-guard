import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { APP_CONFIG, AppConfig } from '../config/app-config';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: config.databasePool.max,
      idleTimeoutMillis: config.databasePool.idleTimeoutMs,
      connectionTimeoutMillis: config.databasePool.connectionTimeoutMs,
      query_timeout: config.databasePool.queryTimeoutMs,
      statement_timeout: config.databasePool.statementTimeoutMs,
      keepAlive: true,
      keepAliveInitialDelayMillis:
        config.databasePool.keepAliveInitialDelayMs,
      maxUses: config.databasePool.maxUses,
      maxLifetimeSeconds: config.databasePool.maxLifetimeSeconds,
      application_name: 'payguard-api',
    });
    this.pool.on('error', (error) => {
      this.logger.error(
        JSON.stringify({
          event: 'database.idle_client_error',
          code: databaseErrorCode(error) ?? 'UNKNOWN',
        }),
      );
    });
  }

  query<T extends QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, [...values]);
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let destroyClient = false;
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      destroyClient = isDatabaseConnectionError(error);
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        destroyClient = true;
        this.logger.warn(
          JSON.stringify({
            event: 'database.transaction_rollback_failed',
            code: databaseErrorCode(rollbackError) ?? 'UNKNOWN',
          }),
        );
      }
      throw error;
    } finally {
      client.release(destroyClient);
    }
  }

  async isReady(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

const connectionErrorCodes = new Set([
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  '57P01',
  '57P02',
  '57P03',
]);

export function databaseErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export function isDatabaseConnectionError(error: unknown): boolean {
  const code = databaseErrorCode(error);
  return (
    code !== undefined &&
    (connectionErrorCodes.has(code) || code.startsWith('08'))
  );
}
