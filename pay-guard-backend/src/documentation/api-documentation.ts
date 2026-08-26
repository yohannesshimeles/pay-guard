import { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  DocumentBuilder,
  OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { createPostmanCollection } from './postman-collection';
import { getSchemaPath } from '@nestjs/swagger';
import {
  ApiErrorDetailSchema,
  ApiErrorResponseSchema,
} from './error-response.schema';

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

  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
    extraModels: [ApiErrorDetailSchema, ApiErrorResponseSchema],
  });
  addStandardErrorResponses(document);
  return document;
}

function addStandardErrorResponses(document: OpenAPIObject): void {
  const methods = [
    'get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace',
  ] as const;
  const statuses: Readonly<Record<string, string>> = {
    '400': 'Malformed or invalid request',
    '401': 'Authentication failed or access token is invalid',
    '403': 'Authenticated principal is not allowed to perform the operation',
    '404': 'Requested resource was not found',
    '409': 'Request conflicts with current resource state',
    '413': 'Uploaded payload exceeds the configured limit',
    '422': 'Request is well-formed but violates a business rule',
    '429': 'Rate limit exceeded',
    '500': 'Unexpected internal failure',
    '503': 'Required dependency is unavailable',
  };
  for (const path of Object.values(document.paths)) {
    for (const method of methods) {
      const operation = path[method];
      if (!operation) continue;
      const responses = operation.responses;
      for (const [status, description] of Object.entries(statuses)) {
        responses[status] ??= {
          description,
          content: {
            'application/json': {
              schema: { $ref: getSchemaPath(ApiErrorResponseSchema) },
            },
          },
        };
      }
    }
  }
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
