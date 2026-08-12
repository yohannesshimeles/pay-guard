import { OpenAPIObject } from '@nestjs/swagger';
import { createPostmanCollection } from '../../src/documentation/postman-collection';

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
});
