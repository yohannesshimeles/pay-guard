const { readFileSync, readdirSync } = require('node:fs');
const { extname, join, relative, resolve } = require('node:path');

const workspace = resolve(__dirname, '..');
const sourceRoot = join(workspace, 'src');
const rules = [
  {
    name: 'raw error.message access',
    pattern: /\berror\.message\b/gu,
  },
  {
    name: 'serialized error object',
    pattern: /JSON\.stringify\(\s*(?:error|exception)\s*\)/gu,
  },
  {
    name: 'direct error console output',
    pattern: /console\.(?:error|warn|log)\(\s*(?:error|exception)\b/gu,
  },
  {
    name: 'request headers in application log',
    pattern: /logger\.(?:debug|log|warn|error)\([\s\S]{0,500}\brequest\.headers\b/gu,
  },
  {
    name: 'request body in application log',
    pattern: /logger\.(?:debug|log|warn|error)\([\s\S]{0,500}\brequest\.body\b/gu,
  },
  {
    name: 'raw request URL in application log',
    pattern: /logger\.(?:debug|log|warn|error)\([\s\S]{0,500}\brequest\.url\b/gu,
  },
  {
    name: 'request query in application log',
    pattern: /logger\.(?:debug|log|warn|error)\([\s\S]{0,500}\brequest\.query\b/gu,
  },
];

const violations = [];
for (const file of sourceFiles(sourceRoot)) {
  const contents = readFileSync(file, 'utf8');
  for (const rule of rules) {
    for (const match of contents.matchAll(rule.pattern)) {
      violations.push({
        file: relative(workspace, file).replaceAll('\\', '/'),
        line: contents.slice(0, match.index).split(/\r?\n/u).length,
        rule: rule.name,
      });
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`${JSON.stringify({ status: 'FAILED', violations }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({
    status: 'PASSED',
    filesScanned: sourceFiles(sourceRoot).length,
    rules: rules.map((rule) => rule.name),
  }, null, 2)}\n`);
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : [path];
    })
    .filter((file) => extname(file) === '.ts');
}
