const path = require('node:path');
const { spawnSync } = require('node:child_process');

const image =
  'node:20.19.0-bookworm-slim@sha256:5cfa999422613d3b34f766cbb814d964cbfcb76aaf3607e805da21cccb352bac';
const sourceDirectory = path.resolve('.');
const startedAt = Date.now();
const command = `
set -eu
cp /source/package.json /source/package-lock.json /source/nest-cli.json \
  /source/tsconfig.json /source/tsconfig.build.json /source/jest.config.js \
  /source/jest.pdf-worker.json /source/eslint.config.mjs /work/
for directory in database docs migrations monitoring postman scripts src test; do
  cp -R "/source/$directory" /work/
done
npm ci --no-audit --no-fund
npm run test:pdf-worker
npm test
npm run lint
npm run typecheck
npm run build
`;

const result = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '--platform',
    'linux/amd64',
    '--mount',
    `type=bind,source=${sourceDirectory},target=/source,readonly`,
    '--tmpfs',
    '/work:rw,exec,nosuid,size=4g',
    '--workdir',
    '/work',
    '--env',
    'CI=true',
    '--env',
    'NODE_ENV=test',
    image,
    'sh',
    '-c',
    command,
  ],
  { stdio: 'inherit' },
);

if (result.error) {
  console.error(
    'Node 20 Linux parity validation failed: Docker is unavailable.',
  );
  process.exitCode = 1;
} else if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
} else {
  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        platform: 'linux/amd64',
        node: '20.19.0',
        sourceReadOnly: true,
        workspaceEphemeral: true,
        durationSeconds: Math.round((Date.now() - startedAt) / 1000),
      },
      null,
      2,
    ),
  );
}
