import { Global, Module } from '@nestjs/common';
import { MetricsInterceptor } from './metrics.interceptor';
import { MetricsService } from './metrics.service';
import { RequestLoggingInterceptor } from './request-logging.interceptor';

@Global()
@Module({
  providers: [MetricsService, MetricsInterceptor, RequestLoggingInterceptor],
  exports: [MetricsService, MetricsInterceptor, RequestLoggingInterceptor],
})
export class ObservabilityModule {}
