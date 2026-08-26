# API documentation and client contract workflow

The NestJS controllers and DTOs are the source of truth for the PayGuard HTTP
contract. Swagger/OpenAPI and Postman are generated from the same runtime document,
so the Android app, web portal and test clients consume one consistent API surface.

## Local endpoints

Start the backend in development mode, then use:

| Resource | URL |
| --- | --- |
| Swagger UI | `http://localhost:4000/docs` |
| OpenAPI JSON | `http://localhost:4000/docs-json` |
| OpenAPI YAML | `http://localhost:4000/docs-yaml` |
| Postman collection | `http://localhost:4000/docs/postman.json` |

Documentation endpoints are disabled when `NODE_ENV=production`.

## Error contract

Every non-success response uses one envelope across controllers, guards, validation,
domain services, data access, and unexpected infrastructure failures:

```json
{
  "success": false,
  "message": "Invalid credentials",
  "data": null,
  "error": {
    "code": "PG_AUTHENTICATION_INVALID_CREDENTIALS_5A7D13C4",
    "description": "Invalid credentials",
    "details": ["optional safe validation or business-rule context"],
    "stackTrace": "present only outside production"
  },
  "correlationId": "4328d00e-0c78-4413-8b3f-b1f92268569f"
}
```

- `error.code` is mandatory. Existing exception points receive a deterministic code
  derived from status, exception class, and the complete safe description. The hash
  suffix prevents truncated descriptions from colliding. Identical semantic failures
  intentionally share a code across modules.
- `error.description` is mandatory and safe for an API consumer. Validation failures
  retain individual messages in `error.details`.
- `error.stackTrace` is sanitized and emitted only when `NODE_ENV` is not
  `production`. Production returns a generic description for unexpected 5xx failures
  and never exposes a stack trace or underlying database/provider message.
- `correlationId` is mandatory and should be supplied with the error code to support.
- Clients must branch on `error.code`, never on `message` or `description`.

Named database codes are stable and do not depend on PostgreSQL's raw message:

| PayGuard code | PostgreSQL code | Description |
| --- | --- | --- |
| `PG_DATABASE_INVALID_CATALOG` | `3D000` | Configured database does not exist or cannot be opened. |
| `PG_DATABASE_FOREIGN_KEY_VIOLATION` | `23503` | Related record is absent or still in use. |
| `PG_DATABASE_UNIQUE_CONSTRAINT_VIOLATION` | `23505` | Unique record conflict. |
| `PG_DATABASE_CHECK_CONSTRAINT_VIOLATION` | `23514` | Database integrity rule rejected the data. |
| `PG_DATABASE_SERIALIZATION_FAILURE` | `40001` | Concurrent transaction may be retried. |
| `PG_DATABASE_DEADLOCK` | `40P01` | Deadlocked transaction may be retried. |
| `PG_DATABASE_QUERY_CANCELLED` | `57014` | Query exceeded its deadline or was cancelled. |
| `PG_DATABASE_CONNECTION_FAILED` | `08001` | PostgreSQL connection could not be established. |
| `PG_DATABASE_CONNECTION_LOST` | `08006` | PostgreSQL connection was lost. |

The generated OpenAPI document registers this envelope for standard `400`, `401`,
`403`, `404`, `409`, `413`, `422`, `429`, `500`, and `503` responses on every
operation. New explicitly catalogued failures can use `CodedHttpException`; existing
Nest exceptions are resolved at the global boundary so an `HTTP_###`-only code can no
longer escape.

The committed consumer artifacts are:

- `docs/api/openapi.json`
- `postman/PayGuard.postman_collection.json`

The current contract contains 90 operations. The generated Postman collection
contains the same 90 requests, grouped by OpenAPI tag.

## Required workflow for every API change

1. Add or change the controller route and its DTOs.
2. Add validation decorators and JSDoc comments that describe client-visible fields.
3. Add `@ApiOperation`, `@ApiResponse`, or explicit schema decorators when inference
   is insufficient, especially for multipart bodies and non-DTO response shapes.
4. Run `npm run test:api-docs` and `npm run build`.
5. Run `npm run docs:export` to regenerate both committed artifacts.
6. Run `npm run docs:check` before review. It exits non-zero if either artifact has
   drifted from the registered controllers and DTO metadata.

The Nest Swagger compiler plugin is enabled in `nest-cli.json`, including the
`class-validator` shim and DTO comment introspection. This automatically carries
DTO types, required fields and validation constraints into the OpenAPI schemas.

## Web and Android consumption

Generate typed clients from `docs/api/openapi.json` in each client build rather than
duplicating endpoint strings or request/response interfaces. Both clients should
use `/api/v1` as the API prefix and send JWT access tokens as Bearer authorization.

The API wraps successful JSON responses in the standard PayGuard response envelope.
File-upload endpoints use `multipart/form-data`; the generated Postman requests mark
binary fields as files.

## Postman

Import `postman/PayGuard.postman_collection.json`. Set `baseUrl`, `accessToken`, and
the generated identifier variables before running protected requests. Every request
has a basic 2xx response test. See `postman/README.md` for local setup.
