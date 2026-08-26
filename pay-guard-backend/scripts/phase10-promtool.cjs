const path = require('node:path');
const { spawnSync } = require('node:child_process');

const prometheusImage =
  'prom/prometheus:v3.13.1@sha256:3c42b892cf723fa54d2f262c37a0e1f80aa8c8ddb1da7b9b0df9455a35a7f893';
const rulesDirectory = path.resolve('monitoring');
const result = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '--volume',
    `${rulesDirectory}:/rules:ro`,
    '--entrypoint',
    '/bin/promtool',
    prometheusImage,
    'check',
    'rules',
    '/rules/payguard.rules.yml',
  ],
  { stdio: 'inherit' },
);

if (result.error) {
  console.error('Promtool validation failed: Docker is unavailable.');
  process.exitCode = 1;
} else if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
}
