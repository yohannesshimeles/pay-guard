# Phase 9 Upload Security Validation

Validated controls:

- uploads accept only exact JPEG, PNG and PDF MIME values with matching filename
  extensions and binary signatures;
- unsafe filenames, empty bodies, MIME-confused content and files above 10 MiB are
  rejected before malware scanning or native decoding;
- PDFs containing active JavaScript, automatic actions, launch actions, embedded
  files, rich media or XFA are rejected before parsing;
- ClamAV runs before image/PDF decoding and fails closed for infected files or scanner
  errors; hostile PDF and image corpus cases reach neither decoder nor storage;
- image decoding uses strict Sharp errors, a 16-million-pixel ceiling, sequential
  reads and a five-second timeout;
- PDF parsing runs in an isolated worker with memory/stack limits, a ten-second job
  timeout, evaluation disabled, at most three pages and 16 million pixels per page;
- storage object names are server-generated beneath private prefixes and never derived
  from client filenames;
- no signed-URL implementation exists: authenticated services stream authorized
  objects through the application, while public models omit object keys and hashes.

Repeatable evidence:

- focused validator, intake, controller, decoder and public-model tests exercise the
  hostile corpus and sanitized failure behavior;
- `npm run test:phase9:uploads` scans production source, OpenAPI and Postman artifacts
  for signed-URL implementations or public storage-key exposure.
