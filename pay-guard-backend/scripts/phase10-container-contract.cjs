const { spawnSync } = require('node:child_process');

const [
  apiImage = 'payguard-api:phase10',
  workerImage = 'payguard-worker:phase10',
  expectedApiRevision = 'api-contract',
  expectedWorkerRevision = 'worker-contract',
] = process.argv.slice(2);

function runDocker(args) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `docker ${args[0]} failed for ${args.at(-1)}: ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

function inspect(image) {
  const documents = JSON.parse(runDocker(['image', 'inspect', image]));
  if (!Array.isArray(documents) || documents.length !== 1) {
    throw new Error(`${image}: expected exactly one inspected image`);
  }
  return documents[0];
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function validateSharedContract(image, document, expectedRevision) {
  const config = document.Config ?? {};
  requireValue(config.User === 'node', `${image}: runtime user must be node`);
  requireValue(
    config.Labels?.['org.opencontainers.image.revision'] === expectedRevision,
    `${image}: revision label does not match the built revision`,
  );
  requireValue(
    (config.Env ?? []).includes('NODE_ENV=production'),
    `${image}: NODE_ENV must be production`,
  );

  runDocker([
    'run',
    '--rm',
    '--entrypoint',
    'sh',
    image,
    '-c',
    'test ! -e /usr/local/bin/npm && test -f /app/migrations/001_foundation.sql && test -d /app/database/initial',
  ]);
}

function main() {
  const api = inspect(apiImage);
  const worker = inspect(workerImage);
  validateSharedContract(apiImage, api, expectedApiRevision);
  validateSharedContract(workerImage, worker, expectedWorkerRevision);

  requireValue(
    JSON.stringify(api.Config?.Cmd) === JSON.stringify(['node', 'dist/main.js']),
    `${apiImage}: API command must start dist/main.js`,
  );
  const apiHealth = api.Config?.Healthcheck?.Test ?? [];
  requireValue(
    apiHealth.some((part) => String(part).includes('/health/live')),
    `${apiImage}: API health check must call /health/live`,
  );

  requireValue(
    JSON.stringify(worker.Config?.Cmd) ===
      JSON.stringify(['node', 'dist/worker.js']),
    `${workerImage}: worker command must start dist/worker.js`,
  );
  requireValue(
    JSON.stringify(worker.Config?.Healthcheck?.Test) ===
      JSON.stringify(['NONE']),
    `${workerImage}: worker must explicitly disable the inherited HTTP health check`,
  );
  requireValue(api.Id !== worker.Id, 'API and worker images must be distinct');

  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        api: {
          image: apiImage,
          command: api.Config.Cmd,
          healthEndpoint: '/health/live',
          revision: expectedApiRevision,
        },
        worker: {
          image: workerImage,
          command: worker.Config.Cmd,
          healthcheck: 'disabled',
          revision: expectedWorkerRevision,
        },
        shared: {
          user: 'node',
          nodeEnvironment: 'production',
          npmCliPresent: false,
          migrationAssetsPresent: true,
        },
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error(`Container contract validation failed: ${error.message}`);
  process.exitCode = 1;
}
