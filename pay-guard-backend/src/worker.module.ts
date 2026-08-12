import { DynamicModule, Module } from '@nestjs/common';
import { AppModule } from './app.module';
import { AppConfig } from './config/app-config';
import { QueuesModule } from './queues/queues.module';
import { NotificationModule } from './notifications/notification.module';
import { NotificationWorkerRunner } from './notifications/notification-worker.runner';

@Module({})
export class WorkerModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: WorkerModule,
      imports: [AppModule.register(config), QueuesModule, NotificationModule],
      providers: [NotificationWorkerRunner],
    };
  }
}
