import { OpenAPIObject } from '@nestjs/swagger';

type JsonSchema = {
  $ref?: string;
  type?: string;
  format?: string;
  example?: unknown;
  default?: unknown;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  allOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
};

type Parameter = {
  in?: string;
  name: string;
  required?: boolean;
  description?: string;
  example?: unknown;
  schema?: JsonSchema;
};

type Operation = {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  security?: Array<Record<string, string[]>>;
  parameters?: Parameter[];
  requestBody?: {
    content?: Record<string, { schema?: JsonSchema }>;
  };
};

type PostmanItem = {
  name: string;
  request: Record<string, unknown>;
  event?: Array<Record<string, unknown>>;
  response: unknown[];
};

export type PostmanCollection = {
  info: {
    _postman_id: string;
    name: string;
    description: string;
    schema: string;
  };
  auth: Record<string, unknown>;
  variable: Array<{ key: string; value: string; type?: string }>;
  item: Array<{ name: string; item: PostmanItem[] }>;
};

const HTTP_METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
] as const;

function resolveSchema(
  schema: JsonSchema | undefined,
  document: OpenAPIObject,
  seen = new Set<string>(),
): JsonSchema | undefined {
  if (!schema?.$ref) return schema;
  if (seen.has(schema.$ref)) return undefined;
  seen.add(schema.$ref);
  const name = schema.$ref.split('/').at(-1);
  const resolved = name
    ? document.components?.schemas?.[name]
    : undefined;
  return resolveSchema(resolved, document, seen);
}

function exampleForSchema(
  input: JsonSchema | undefined,
  document: OpenAPIObject,
  seen = new Set<string>(),
): unknown {
  if (!input) return {};
  if (input.example !== undefined) return input.example;
  if (input.default !== undefined) return input.default;
  if (input.enum?.length) return input.enum[0];

  if (input.$ref) {
    if (seen.has(input.$ref)) return {};
    seen.add(input.$ref);
    return exampleForSchema(resolveSchema(input, document), document, seen);
  }

  const composite = input.allOf ?? input.oneOf ?? input.anyOf;
  if (composite?.length) {
    const values = composite.map((part) =>
      exampleForSchema(part, document, new Set(seen)),
    );
    if (values.every((value) => value && typeof value === 'object')) {
      return Object.assign({}, ...values);
    }
    return values[0];
  }

  if (input.type === 'array') {
    return [exampleForSchema(input.items, document, seen)];
  }
  if (input.type === 'object' || input.properties) {
    return Object.fromEntries(
      Object.entries(input.properties ?? {}).map(([key, schema]) => [
        key,
        exampleForSchema(schema, document, new Set(seen)),
      ]),
    );
  }
  if (input.format === 'date-time') return '2026-01-01T00:00:00.000Z';
  if (input.format === 'date') return '2026-01-01';
  if (input.format === 'uuid') return '00000000-0000-4000-8000-000000000001';
  if (input.format === 'email') return 'user@example.com';
  if (input.type === 'integer' || input.type === 'number') return 1;
  if (input.type === 'boolean') return true;
  return 'string';
}

function postmanPath(path: string): string {
  return path.replace(/{([^}]+)}/g, '{{$1}}');
}

function requestBody(
  operation: Operation,
  document: OpenAPIObject,
): Record<string, unknown> | undefined {
  const content = operation.requestBody?.content;
  if (!content) return undefined;

  const multipart = content['multipart/form-data'];
  if (multipart) {
    const schema = resolveSchema(multipart.schema, document);
    return {
      mode: 'formdata',
      formdata: Object.entries(schema?.properties ?? {}).map(([key, value]) => ({
        key,
        type: value.format === 'binary' ? 'file' : 'text',
        src: value.format === 'binary' ? [] : undefined,
        value:
          value.format === 'binary'
            ? undefined
            : String(exampleForSchema(value, document)),
      })),
    };
  }

  const json = content['application/json'];
  if (!json) return undefined;
  return {
    mode: 'raw',
    raw: JSON.stringify(exampleForSchema(json.schema, document), null, 2),
    options: { raw: { language: 'json' } },
  };
}

function buildRequest(
  method: string,
  path: string,
  operation: Operation,
  document: OpenAPIObject,
): Record<string, unknown> {
  const parameters = operation.parameters ?? [];
  const query = parameters
    .filter((parameter) => parameter.in === 'query')
    .map((parameter) => ({
      key: parameter.name,
      value: String(
        parameter.example ??
          exampleForSchema(parameter.schema as JsonSchema, document),
      ),
      disabled: !parameter.required,
      description: parameter.description,
    }));
  const headers = parameters
    .filter((parameter) => parameter.in === 'header')
    .map((parameter) => ({
      key: parameter.name,
      value: String(
        parameter.example ??
          exampleForSchema(parameter.schema as JsonSchema, document),
      ),
      disabled: !parameter.required,
      description: parameter.description,
    }));
  const body = requestBody(operation, document);
  if (body?.mode === 'raw') {
    headers.push({
      key: 'Content-Type',
      value: 'application/json',
      disabled: false,
      description: 'Generated from the OpenAPI request body.',
    });
  }

  const urlPath = postmanPath(path);
  return {
    method: method.toUpperCase(),
    header: headers,
    body,
    auth: operation.security?.length === 0 ? { type: 'noauth' } : undefined,
    url: {
      raw: `{{baseUrl}}${urlPath}`,
      host: ['{{baseUrl}}'],
      path: urlPath.split('/').filter(Boolean),
      query,
    },
    description: operation.description ?? operation.summary,
  };
}

export function createPostmanCollection(
  document: OpenAPIObject,
): PostmanCollection {
  const folders = new Map<string, PostmanItem[]>();
  const pathVariables = new Set<string>();

  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const match of path.matchAll(/{([^}]+)}/g)) pathVariables.add(match[1]);
    for (const method of HTTP_METHODS) {
      const operation = (
        pathItem as unknown as Record<string, Operation | undefined>
      )?.[method];
      if (!operation) continue;
      const tag = operation.tags?.[0] ?? 'Other';
      const items = folders.get(tag) ?? [];
      items.push({
        name: operation.summary ?? operation.operationId ?? `${method} ${path}`,
        request: buildRequest(method, path, operation, document),
        event: [
          {
            listen: 'test',
            script: {
              type: 'text/javascript',
              exec: [
                "pm.test('Successful response', () => pm.expect(pm.response.code).to.be.within(200, 299));",
              ],
            },
          },
        ],
        response: [],
      });
      folders.set(tag, items);
    }
  }

  return {
    info: {
      _postman_id: '7d71b9a7-178d-4fcf-b641-3c9fcdcf37ad',
      name: `${document.info.title} ${document.info.version}`,
      description:
        'Generated from the PayGuard OpenAPI contract. Regenerate after every API change; do not edit this collection manually.',
      schema:
        'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    auth: {
      type: 'bearer',
      bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }],
    },
    variable: [
      { key: 'baseUrl', value: 'http://localhost:4000', type: 'string' },
      { key: 'accessToken', value: '', type: 'string' },
      ...[...pathVariables]
        .sort()
        .map((key) => ({ key, value: `replace-${key}`, type: 'string' })),
    ],
    item: [...folders.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, item]) => ({ name, item })),
  };
}
