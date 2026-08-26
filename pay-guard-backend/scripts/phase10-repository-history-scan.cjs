const { execFileSync } = require('node:child_process');

const repositoryRoot = execFileSync('git', ['rev-parse', '--show-toplevel'],
  { encoding: 'utf8' }).trim();
const commitCount = Number(execFileSync('git', ['rev-list', '--all', '--count'],
  { cwd: repositoryRoot, encoding: 'utf8' }).trim());
const history = execFileSync('git', [
  'log', '--all', '--full-history', '--no-ext-diff', '--no-color',
  '--format=commit %H', '-p',
], { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

const secretRules = [
  ['private key material', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u],
  ['GitHub token', /\bgh[opsu]_[A-Za-z0-9]{36,255}\b/u],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u],
  ['Stripe live key', /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/u],
  ['encoded JWT', /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\b/u],
];
const credentialAssignment = /\b(?:JWT_ACCESS_SECRET|ACCOUNT_ENCRYPTION_KEY|ARCHIVE_ENCRYPTION_KEY|S3_SECRET_ACCESS_KEY|VERIFYET_API_KEY|FIREBASE_PRIVATE_KEY)\s*[=:]\s*["']?([^\s"',}]+)/iu;
const hardcodedSecretProperty = /\b(?:jwtAccessSecret|accountEncryptionKey|archiveEncryptionKey|secretAccessKey|apiKey|privateKey)\s*:\s*["']([^"']{16,})["']/iu;
const fullAccount = /\b(?:account(?:_?(?:number|value))?|receiver_?account|settlement_?account)[^\r\n]{0,32}?["'=:\s]+([0-9]{8,24})(?![0-9-])/iu;
const findings = [];
let currentCommit = 'unknown';
let currentPath = 'unknown';
let patchLinesScanned = 0;
let syntheticFixtureAccountLines = 0;

for (const rawLine of history.split(/\r?\n/u)) {
  if (rawLine.startsWith('commit ')) {
    currentCommit = rawLine.slice(7, 19);
    continue;
  }
  if (rawLine.startsWith('diff --git ')) {
    const match = /^diff --git a\/(.+) b\/(.+)$/u.exec(rawLine);
    currentPath = match?.[2] ?? 'unknown';
    continue;
  }
  if ((!rawLine.startsWith('+') && !rawLine.startsWith('-')) ||
      rawLine.startsWith('+++') || rawLine.startsWith('---')) continue;
  patchLinesScanned += 1;
  const line = rawLine.slice(1);
  for (const [rule, pattern] of secretRules) {
    if (pattern.test(line) && !isPlaceholder(line)) add(rule);
  }
  const assignment = credentialAssignment.exec(line);
  if (assignment && isCredentialConfigPath(currentPath) &&
      !isPlaceholder(assignment[1])) add('credential assignment');
  const property = hardcodedSecretProperty.exec(line);
  if (property && !isFixturePath(currentPath) &&
      !isPlaceholder(property[1])) add('hard-coded secret property');
  if (fullAccount.test(line)) {
    if (isFixturePath(currentPath)) syntheticFixtureAccountLines += 1;
    else add('full account number outside a test fixture');
  }
}

if (findings.length > 0) {
  process.stderr.write(`Repository history scan failed with ${findings.length} finding(s):\n`);
  for (const finding of findings) {
    process.stderr.write(`- ${finding.commit} ${finding.path} (${finding.rule})\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(JSON.stringify({ commitCount, patchLinesScanned,
    secretRules: secretRules.length + 1, findings: 0,
    syntheticFixtureAccountLines }, null, 2) + '\n');
}

function add(rule) {
  findings.push({ commit: currentCommit, path: currentPath, rule });
}

function isPlaceholder(value) {
  return /(?:\.\.\.|replace|example|placeholder|your-|test-|do-not-store|private|short|secret.{0,8}(?:long|character)|[x*]{4,})/iu.test(value);
}

function isCredentialConfigPath(file) {
  if (/\.env\.example$/iu.test(file)) return false;
  return /(?:^|\/)\.env(?:\.[^/]+)?$|\.(?:ya?ml|toml|properties)$/iu.test(file) ||
    /(?:^|\/)(?:terraform|infra|k8s|helm|deploy)(?:\/|$)/iu.test(file);
}

function isFixturePath(file) {
  return /(?:^|\/)(?:test|tests|__tests__|fixtures)(?:\/|$)|\.(?:spec|test)\.[cm]?[jt]sx?$/iu.test(file);
}
