import {
  Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown,
} from '@nestjs/common';
import { hostname } from 'node:os';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { resolvePublicError } from '../common/error-contract';
import { MetricsService } from '../observability/metrics.service';
import { VerifyEtWorkerService } from './verify-et-worker.service';

@Injectable()
export class VerifyEtWorkerRunner
implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(VerifyEtWorkerRunner.name);
  private readonly workerId = `verifyet:${hostname().replace(/[^A-Za-z0-9._-]/gu, '_')}:${process.pid}`
    .slice(0, 120);
  private timer?: NodeJS.Timeout;
  private active = false;
  private stopped = false;

  constructor(
    private readonly worker: VerifyEtWorkerService,
    private readonly metrics: MetricsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    this.stopped = false;
    if (this.config.verifyEt.enabled) this.schedule(0);
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), delay);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    if (this.active) return this.schedule(this.config.notificationWorkerPollMs);
    this.active = true;
    try {
      for (let count = 0; count < 25; count += 1) {
        const result = await this.worker.processNext(this.workerId);
        this.metrics.workerResults.inc({ worker: 'verify_et', outcome: result.status });
        if (result.status === 'IDLE') break;
      }
    } catch (error) {
      this.metrics.workerTickFailures.inc({ worker: 'verify_et' });
      this.logger.error(JSON.stringify({
        event: 'verify_et.worker_tick_failed',
        error: resolvePublicError(error, 500, undefined),
      }));
    } finally {
      this.active = false;
      if (!this.stopped) this.schedule(this.config.notificationWorkerPollMs);
    }
  }
}
