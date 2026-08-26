import { OpenAPIObject } from '@nestjs/swagger';
import { readFileSync } from 'node:fs';
import {
  createPostmanCollection,
  createPostmanEnvironment,
  PostmanCollection,
  PostmanEnvironment,
} from '../../src/documentation/postman-collection';

describe('Postman collection generation', () => {
  it('creates one request for every OpenAPI operation', () => {
    const document: OpenAPIObject = {
      openapi: '3.0.0',
      info: { title: 'PayGuard API', version: '2.0.0' },
      paths: {
        '/api/v1/auth/login': {
          post: {
            tags: ['Authentication'],
            operationId: 'Auth_login',
            summary: 'Log in',
            security: [],
            responses: { 200: { description: 'Authenticated' } },
          },
        },
        '/api/v1/businesses/{businessId}/transactions': {
          get: {
            tags: ['Transactions'],
            operationId: 'Transactions_list',
            summary: 'List transactions',
            responses: { 200: { description: 'Transactions' } },
          },
          post: {
            tags: ['Transactions'],
            operationId: 'Transactions_create',
            summary: 'Create a transaction',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { amount: { type: 'number' } },
                  },
                },
              },
            },
            responses: { 201: { description: 'Created' } },
          },
        },
      },
      components: {},
    };

    const collection = createPostmanCollection(document);
    const requests = collection.item.flatMap((folder) => folder.item);

    expect(requests).toHaveLength(3);
    expect(collection.variable).toContainEqual({
      key: 'businessId',
      value: 'replace-businessId',
      type: 'string',
    });
    expect(requests.find((item) => item.name === 'Log in')?.request.auth).toEqual({
      type: 'noauth',
    });
  });

  it('keeps every committed Postman asset in exact OpenAPI parity', () => {
    const document = JSON.parse(
      readFileSync('docs/api/openapi.json', 'utf8'),
    ) as OpenAPIObject;
    const committedCollection = JSON.parse(
      readFileSync('postman/PayGuard.postman_collection.json', 'utf8'),
    ) as PostmanCollection;
    const committedEnvironment = JSON.parse(
      readFileSync('postman/PayGuard-Local.postman_environment.json', 'utf8'),
    ) as PostmanEnvironment;
    const expectedCollection = JSON.parse(JSON.stringify(
      createPostmanCollection(document),
    )) as PostmanCollection;
    const expectedEnvironment = createPostmanEnvironment(expectedCollection);

    expect(committedCollection).toEqual(expectedCollection);
    expect(committedEnvironment).toEqual(expectedEnvironment);

    const operations = Object.values(document.paths).reduce(
      (count, path) => count + Object.keys(path).filter((method) =>
        ['get', 'post', 'put', 'patch', 'delete', 'options', 'head']
          .includes(method),
      ).length,
      0,
    );
    const requests = committedCollection.item.flatMap((folder) => folder.item);
    expect(requests).toHaveLength(operations);
    expect(new Set(requests.map((item) =>
      `${String(item.request.method)} ${String(
        (item.request.url as { raw: string }).raw,
      )}`,
    )).size).toBe(operations);
  });
});
