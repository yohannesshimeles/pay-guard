const { hash } = require('bcryptjs');
const { Client } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
const schemaVersion = process.env.DATABASE_SCHEMA_VERSION || 'legacy';
const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

if (!databaseUrl) throw new Error('DATABASE_URL is required');
if (!['legacy', 'v2'].includes(schemaVersion)) {
  throw new Error('DATABASE_SCHEMA_VERSION must be legacy or v2');
}
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error('BOOTSTRAP_ADMIN_EMAIL must be a valid email address');
}
if (!password || password.length < 12) {
  throw new Error('BOOTSTRAP_ADMIN_PASSWORD must contain at least 12 characters');
}

async function bootstrapLegacy(client, passwordHash) {
  const current = await client.query(
    `SELECT u.id, u.email
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     WHERE ur.role_code = 'PLATFORM_SUPER_ADMIN'
     FOR UPDATE OF u`,
  );
  if (current.rowCount) return current.rows[0];

  const existingIdentity = await client.query(
    'SELECT id FROM users WHERE lower(email) = lower($1)',
    [email],
  );
  if (existingIdentity.rowCount) {
    throw new Error('The bootstrap email already belongs to another user');
  }

  const user = await client.query(
    `INSERT INTO users (email, password_hash, status)
     VALUES ($1, $2, 'ACTIVE') RETURNING id, email`,
    [email, passwordHash],
  );
  await client.query(
    `INSERT INTO user_roles (user_id, role_code)
     VALUES ($1, 'PLATFORM_SUPER_ADMIN')`,
    [user.rows[0].id],
  );
  await client.query(
    `INSERT INTO audit_logs (
       actor_user_id, action, target_type, target_id, metadata, correlation_id
     ) VALUES (
       $1, 'platform_admin.bootstrapped', 'user', $2, $3, 'bootstrap-cli'
     )`,
    [user.rows[0].id, user.rows[0].id, JSON.stringify({ email })],
  );
  return user.rows[0];
}

async function bootstrapV2(client, passwordHash) {
  const fullName = process.env.BOOTSTRAP_ADMIN_FULL_NAME?.trim();
  const phoneNumber = process.env.BOOTSTRAP_ADMIN_PHONE?.trim();
  const jobTitle = process.env.BOOTSTRAP_ADMIN_JOB_TITLE?.trim();
  if (!fullName || fullName.length < 3) {
    throw new Error('BOOTSTRAP_ADMIN_FULL_NAME must contain at least 3 characters');
  }
  if (!phoneNumber || !/^\+?[0-9]{9,15}$/.test(phoneNumber)) {
    throw new Error('BOOTSTRAP_ADMIN_PHONE must be a valid international phone number');
  }
  if (!jobTitle || jobTitle.length < 2) {
    throw new Error('BOOTSTRAP_ADMIN_JOB_TITLE must contain at least 2 characters');
  }

  const current = await client.query(
    `SELECT id, email
     FROM platform_admin
     WHERE status = 'ACTIVE'
     FOR UPDATE`,
  );
  if (current.rowCount) return current.rows[0];

  const conflict = await client.query(
    `SELECT id FROM platform_admin
     WHERE lower(email::text) = lower($1) OR phone_number = $2`,
    [email, phoneNumber],
  );
  if (conflict.rowCount) {
    throw new Error('The bootstrap email or phone belongs to another administrator');
  }

  const admin = await client.query(
    `INSERT INTO platform_admin (
       full_name, phone_number, email, password_hash, job_title
     ) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email`,
    [fullName, phoneNumber, email, passwordHash, jobTitle],
  );
  await client.query(
    `INSERT INTO audit_logs (
       platform_admin_id, role_code, action_type, record_type,
       record_id, new_value, result
     ) VALUES ($1, 'PLATFORM_SUPER_ADMIN', 'PLATFORM_ADMIN_BOOTSTRAPPED',
       'PLATFORM_ADMIN', $1, $2, 'SUCCESS')`,
    [admin.rows[0].id, JSON.stringify({ email, phoneNumber, jobTitle })],
  );
  return admin.rows[0];
}

async function main() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('payguard:bootstrap:platform-admin'))",
    );
    const passwordHash = await hash(password, 12);
    const before = await client.query(
      schemaVersion === 'v2'
        ? "SELECT id FROM platform_admin WHERE status = 'ACTIVE' LIMIT 1"
        : `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id
           WHERE ur.role_code = 'PLATFORM_SUPER_ADMIN' LIMIT 1`,
    );
    const admin =
      schemaVersion === 'v2'
        ? await bootstrapV2(client, passwordHash)
        : await bootstrapLegacy(client, passwordHash);
    await client.query('COMMIT');
    process.stdout.write(
      before.rowCount
        ? `Platform Super Admin already exists (${admin.email}). No changes made.\n`
        : `Platform Super Admin created for ${admin.email} using ${schemaVersion}.\n`,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`Admin bootstrap failed: ${error.message}\n`);
  process.exitCode = 1;
});
