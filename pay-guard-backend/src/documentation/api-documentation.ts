import { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  DocumentBuilder,
  OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { createPostmanCollection } from './postman-collection';

export function createApiDocument(
  app: NestFastifyApplication,
): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('PayGuard API')
    .setDescription(
      'Canonical API contract for the PayGuard web portal, Android app, workers, and third-party integrations.',
    )
    .setVersion('2.0.0')
    .addServer('http://localhost:4000', 'Local development')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token returned by POST /api/v1/auth/login.',
      },
      'bearer',
    )
    .build();

  return SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
  });
}

export function configureApiDocumentation(
  app: NestFastifyApplication,
): OpenAPIObject {
  const document = createApiDocument(app);
  const postman = createPostmanCollection(document);

  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: '/docs-json',
    yamlDocumentUrl: '/docs-yaml',
    customSiteTitle: 'PayGuard API Documentation',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });
  app
    .getHttpAdapter()
    .getInstance()
    .get('/docs/postman.json', () => postman);

  return document;
}
