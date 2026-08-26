# Phase 9 Leakage Validation

Implemented controls:

- unhandled HTTP failures return a generic response and log only a bounded error name
  and safe machine code;
- public 4xx text redacts bearer/basic credentials, JWTs, credential-bearing URLs,
  keyed passwords/secrets/tokens, account numbers and raw payload fields;
- application, worker, migration, cutover and documentation startup failures no longer
  emit raw `Error.message` values;
- audit free text uses the same credential redaction boundary while recursive audit
  metadata continues to redact sensitive keys;
- `npm run test:phase9:leakage` scans every production TypeScript source file and fails
  on raw error-message access, serialized error objects or direct error console output.

Validation:

- focused tests inject passwords, access tokens, JWTs, database URL credentials,
  account numbers and provider payload values into public errors and log failures;
- safe output contains only redaction markers or bounded error classification;
- the repeatable production-source leakage scan passes with no violations.

This gate covers application-generated logs and HTTP errors. Infrastructure log access,
retention and external managed-secret rotation remain production operational controls.
