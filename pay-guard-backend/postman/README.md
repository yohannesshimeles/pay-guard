# PayGuard Postman Collection

## Import

Import both files into Postman:

1. `PayGuard.postman_collection.json`
2. `PayGuard-Local.postman_environment.json`

If Postman opens the **Branches** folder instead of its list request, import
`PayGuard-Branch-Setup.postman_collection.json`. Its single top-level request
lists branches for `{{businessId}}` and saves the first returned branch UUID to
the active environment as `branchId`.

Select **PayGuard Local** in the Postman environment selector.

The collection is generated from the same OpenAPI document used by Swagger and
contains every registered API operation. Do not edit generated JSON by hand. After
changing a controller or DTO, use `npm run docs:export`; use `npm run docs:check`
in validation to fail when OpenAPI, the collection or environment is stale.

The latest collection can also be downloaded from
`GET http://localhost:4000/docs/postman.json` while the API is running.

## One-time Platform Super Admin

If the development database has no Platform Super Admin, run these commands from
the backend directory. Choose private values and do not share screenshots containing
the password.

```cmd
set DATABASE_URL=
set "BOOTSTRAP_ADMIN_EMAIL=admin@example.test"
set "BOOTSTRAP_ADMIN_PASSWORD=choose-a-private-password-of-12-or-more-characters"
npm run bootstrap:admin
set BOOTSTRAP_ADMIN_PASSWORD=
```

The command is one-time and refuses to overwrite an existing Platform Super Admin.
Set the same email and password privately in the Postman environment variables
`identity` and `password`.

## Required environment values

Before testing, set the desired login `identity` and its private `password` of 12 or
more characters.

Do not export or commit a Postman environment after it contains real passwords or
tokens. The checked-in environment file contains blank secret values.

## Authentication and identifiers

Run `Authentication / Auth_login`. Its test script captures the returned access and
refresh tokens. `Auth_refresh` rotates both variables and `Auth_logout` clears them.
Then populate the blank identifier variables used by the requests you want to
exercise. Collection folders are grouped by Swagger/OpenAPI tags.

Mutating requests create database records. Adjust their generated example bodies and
identifier variables for the scenario being exercised.

## Expected behavior

- Successful requests receive a 2xx status.
- JSON endpoints use the standard successful response envelope.
- Readiness reports PostgreSQL, Redis and storage as ready.
- The registered business begins `PENDING`, then Super Admin activates it.
- Owner queries remain scoped to the captured business and branch.
- Removed Waiter appears only when `includeRemoved=true`.
- Account APIs return masks and never return supplied full account values.
- Refresh rotates both Owner access and refresh tokens before logout.
