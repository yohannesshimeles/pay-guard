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

The committed consumer artifacts are:

- `docs/api/openapi.json`
- `postman/PayGuard.postman_collection.json`

The current contract contains 79 operations across 68 paths. The generated Postman
collection contains the same 79 requests, grouped by OpenAPI tag.

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
