const { Client } = require('pg');

const adminUrl = process.env.ADMIN_DATABASE_URL;
const databaseName = process.env.TEST_DATABASE_NAME || 'payguard_test';

if (!adminUrl) {
  throw new Error('ADMIN_DATABASE_URL is required');
}
if (!/^[a-z][a-z0-9_]{0,62}$/.test(databaseName)) {
  throw new Error('TEST_DATABASE_NAME contains unsupported characters');
}

async function main() {
  const client = new Client({
    connectionString: adminUrl,
    connectionTimeoutMillis: 3000,
  });
  await client.connect();
  try {
    const existing = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [databaseName],
    );
    if (!existing.rowCount) {
      await client.query(`CREATE DATABASE "${databaseName}"`);
      process.stdout.write(`Created test database ${databaseName}\n`);
    } else {
      process.stdout.write(`Test database ${databaseName} already exists\n`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`Test database preparation failed: ${error.message}\n`);
  process.exitCode = 1;
});
