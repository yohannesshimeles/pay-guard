const { readFileSync, readdirSync } = require('node:fs');
const { extname, join, relative, resolve } = require('node:path');

const workspace = resolve(__dirname, '..');
const sourceRoot = join(workspace, 'src');
const publicArtifacts = [
  join(workspace, 'docs', 'api', 'openapi.json'),
  join(workspace, 'postman', 'PayGuard.postman_collection.json'),
];
const violations = [];

for (const file of sourceFiles(sourceRoot)) {
  const contents = readFileSync(file, 'utf8');
  inspect(file, contents, [
    ['signed URL implementation', /(?:getSignedUrl|presign(?:ed)?Url|s3-request-presigner)/giu],
  ]);
  if (/\.controller\.ts$/u.test(file)) {
    inspect(file, contents, [
      ['storage key in controller', /\b(?:storageObjectKey|storage_object_key)\b/gu],
      ['signed URL in controller', /\b(?:signedUrl|signed_url|presignedUrl)\b/giu],
    ]);
  }
}

for (const file of publicArtifacts) {
  inspect(file, readFileSync(file, 'utf8'), [
    ['storage key in public API artifact', /\b(?:storageObjectKey|storage_object_key)\b/gu],
    ['signed URL in public API artifact', /\b(?:signedUrl|signed_url|presignedUrl|X-Amz-Signature)\b/giu],
  ]);
}

if (violations.length > 0) {
  process.stderr.write(`${JSON.stringify({ status: 'FAILED', violations }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({
    status: 'PASSED',
    sourceFilesScanned: sourceFiles(sourceRoot).length,
    publicArtifactsScanned: publicArtifacts.map((file) => relative(workspace, file)
      .replaceAll('\\', '/')),
    guarantees: [
      'no signed URL implementation',
      'no storage keys or signed URLs in controllers or API artifacts',
    ],
  }, null, 2)}\n`);
}

function inspect(file, contents, rules) {
  for (const [rule, pattern] of rules) {
    for (const match of contents.matchAll(pattern)) {
      violations.push({
        file: relative(workspace, file).replaceAll('\\', '/'),
        line: contents.slice(0, match.index).split(/\r?\n/u).length,
        rule,
      });
    }
  }
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : [path];
    })
    .filter((file) => extname(file) === '.ts');
}
