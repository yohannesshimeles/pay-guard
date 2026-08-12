import { ValidationPipe } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { configureApiDocumentation } from './documentation/api-documentation';
import { ResponseInterceptor } from './common/response.interceptor';
import { MetricsInterceptor } from './observability/metrics.interceptor';

export function configureApplication(
  app: NestFastifyApplication,
  options: { exposeDocumentation?: boolean } = {},
): void {
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
    new ResponseInterceptor(),
  );

  if (options.exposeDocumentation !== false) {
    configureApiDocumentation(app);
  }
}
