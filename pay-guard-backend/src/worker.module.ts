import { DynamicModule, Module } from '@nestjs/common';
import { AppModule } from './app.module';
import { AppConfig } from './config/app-config';
import { QueuesModule } from './queues/queues.module';
import { NotificationModule } from './notifications/notification.module';
import { NotificationWorkerRunner } from './notifications/notification-worker.runner';
import { ReportsModule } from './reports/reports.module';
import { ReportExportWorkerRunner } from './reports/report-export-worker.runner';

@Module({})
export class WorkerModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        AppModule.register(config), QueuesModule, NotificationModule, ReportsModule,
      ],
      providers: [NotificationWorkerRunner, ReportExportWorkerRunner],
    };
  }
}
