# PayGuard Postman Collection

## Import

Import both files into Postman:

1. `PayGuard.postman_collection.json`
2. `PayGuard-Local.postman_environment.json`

Select **PayGuard Local** in the Postman environment selector.

The collection is generated from the same OpenAPI document used by Swagger and
contains every registered API operation. Do not edit it by hand. After changing a
controller or DTO, run the API and use `npm run docs:export`; use
`npm run docs:check` in validation to fail when committed artifacts are stale.

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
`adminEmail` and `adminPassword`.

## Required environment values

Before testing, set private passwords (12 or more characters) for:

- `ownerPassword`
- `managerPassword`
- `cashierPassword`
- `waiterPassword`

Do not export or commit a Postman environment after it contains real passwords or
tokens. The checked-in environment file contains blank secret values.

## Authentication and identifiers

Run `Authentication / Log in`, copy the returned access token into the
`accessToken` collection variable, then replace the generated `replace-*` values
for identifiers used by the requests you want to exercise. Collection folders are
grouped by the Swagger/OpenAPI tags.

The workflow creates database records. For a repeat run, change the Owner/Manager/
Cashier/Waiter emails in the environment. Bank and registration codes use Postman's
timestamp variable and are generated uniquely.

## Expected behavior

- Successful requests receive a 2xx status.
- JSON endpoints use the standard successful response envelope.
- Readiness reports PostgreSQL, Redis and storage as ready.
- The registered business begins `PENDING`, then Super Admin activates it.
- Owner queries remain scoped to the captured business and branch.
- Removed Waiter appears only when `includeRemoved=true`.
- Account APIs return masks and never return supplied full account values.
- Refresh rotates both Owner access and refresh tokens before logout.
