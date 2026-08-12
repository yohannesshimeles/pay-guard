import {
  Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown,
} from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ReportExportWorker } from './report-export.worker';

@Injectable()
export class ReportExportWorkerRunner
implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ReportExportWorkerRunner.name);
  private timer?: NodeJS.Timeout;
  private active = false;
  private stopped = false;

  constructor(
    private readonly worker: ReportExportWorker,
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
        if (await this.worker.processNext() === 'IDLE') break;
      }
    } catch {
      this.logger.error(JSON.stringify({ event: 'report_export.worker_tick_failed' }));
    } finally {
      this.active = false;
      if (!this.stopped) this.schedule(this.config.notificationWorkerPollMs);
    }
  }
}
