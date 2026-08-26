import {
  Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown,
} from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { resolvePublicError } from '../common/error-contract';
import { ArchiveWorker } from './archive.worker';
import { MetricsService } from '../observability/metrics.service';

@Injectable()
export class ArchiveWorkerRunner
implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ArchiveWorkerRunner.name);
  private timer?: NodeJS.Timeout;
  private active = false;
  private stopped = false;

  constructor(
    private readonly worker: ArchiveWorker,
    private readonly metrics: MetricsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    this.stopped = false;
    this.schedule(0);
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
      for (let count = 0; count < 10; count += 1) {
        const result = await this.worker.processNext();
        this.metrics.workerResults.inc({ worker: 'archive', outcome: result });
        if (result === 'IDLE') break;
      }
    } catch (error) {
      this.metrics.workerTickFailures.inc({ worker: 'archive' });
      this.logger.error(JSON.stringify({
        event: 'archive.worker_tick_failed',
        error: resolvePublicError(error, 500, undefined),
      }));
    } finally {
      this.active = false;
      if (!this.stopped) this.schedule(this.config.notificationWorkerPollMs);
    }
  }
}
