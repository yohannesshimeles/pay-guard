const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');

const workspaceFiles = execFileSync('rg', ['--files', '-0'], { encoding: 'utf8' })
  .split('\0').filter(Boolean).map((file) => file.replaceAll('\\', '/'));
const textFiles = workspaceFiles.filter((file) =>
  /(?:^|\/)(?:src|scripts|docs|database)\//u.test(file) ||
  /(?:^|\/)(?:\.env(?:\.example)?|docker-compose\.ya?ml|package\.json)$/u.test(file),
);
const secretRules = [
  ['private key material', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu],
  ['GitHub token', /\bgh[opsu]_[A-Za-z0-9]{36,255}\b/gu],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/gu],
  ['Stripe live key', /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/gu],
  ['encoded JWT', /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\b/gu],
];
const staticRules = [
  ['dynamic code evaluation', /(?<![.\w])eval\s*\(|\bnew\s+Function\s*\(/gu],
  ['process command execution', /from ['"]node:child_process['"]|require\(['"]node:child_process['"]\)/gu],
  ['unsafe shell option', /\bshell\s*:\s*true\b/gu],
];
const findings = [];

for (const file of textFiles) {
  let source;
  try { source = readFileSync(file, 'utf8'); } catch { continue; }
  for (const [rule, pattern] of secretRules) collect(file, source, rule, pattern);
  if (file.startsWith('src/')) {
    for (const [rule, pattern] of staticRules) collect(file, source, rule, pattern);
  }
}

if (findings.length > 0) {
  process.stderr.write(`Phase 9 security scan failed with ${findings.length} finding(s):\n`);
  for (const finding of findings) {
    process.stderr.write(`- ${finding.file}:${finding.line} (${finding.rule})\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(JSON.stringify({ scannedWorkspaceFiles: textFiles.length,
    secretRules: secretRules.length, staticRules: staticRules.length,
    findings: 0 }, null, 2) + '\n');
}

function collect(file, source, rule, pattern) {
  pattern.lastIndex = 0;
  for (const match of source.matchAll(pattern)) {
    const line = source.slice(0, match.index).split('\n').length;
    const lineText = source.split('\n')[line - 1] ?? '';
    if (file.endsWith('.env.example') && lineText.includes('...')) continue;
    findings.push({ file, rule, line });
  }
}
