import { ValidationPipe } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { configureApiDocumentation } from './documentation/api-documentation';
import { ResponseInterceptor } from './common/response.interceptor';
import { MetricsInterceptor } from './observability/metrics.interceptor';
import { RequestLoggingInterceptor } from './observability/request-logging.interceptor';
import { CorrelationMiddleware } from './common/correlation.middleware';

export function configureApplication(
  app: NestFastifyApplication,
  options: { exposeDocumentation?: boolean } = {},
): void {
  const correlation = new CorrelationMiddleware();
  app.use(correlation.use.bind(correlation));
  app.setGlobalPrefix('api/v1', {
    exclude: ['health/live', 'health/ready', 'metrics'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(
    app.get(MetricsInterceptor),
    app.get(RequestLoggingInterceptor),
    new ResponseInterceptor(),
  );

  if (options.exposeDocumentation !== false) {
    configureApiDocumentation(app);
  }
}
