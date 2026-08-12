const { hash } = require('bcryptjs');
const { Client } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
const schemaVersion = process.env.DATABASE_SCHEMA_VERSION || 'legacy';
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const newPassword = process.env.ADMIN_NEW_PASSWORD;

if (!databaseUrl) throw new Error('DATABASE_URL is required');
if (!['legacy', 'v2'].includes(schemaVersion)) {
  throw new Error('DATABASE_SCHEMA_VERSION must be legacy or v2');
}
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error('ADMIN_EMAIL must be a valid email address');
}
if (!newPassword || newPassword.length < 16) {
  throw new Error('ADMIN_NEW_PASSWORD must contain at least 16 characters');
}

async function rotateLegacy(client, passwordHash) {
  const admin = await client.query(
    `SELECT u.id
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     WHERE lower(u.email) = lower($1)
       AND ur.role_code = 'PLATFORM_SUPER_ADMIN'
     FOR UPDATE OF u`,
    [email],
  );
  if (!admin.rowCount) throw new Error('Platform Super Admin was not found');

  await client.query(
    `UPDATE users
     SET password_hash = $2, updated_at = now(), status = 'ACTIVE'
     WHERE id = $1`,
    [admin.rows[0].id, passwordHash],
  );
  await client.query(
    `UPDATE sessions SET revoked_at = now()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [admin.rows[0].id],
  );
  await client.query(
    `INSERT INTO audit_logs (
       actor_user_id, action, target_type, target_id, metadata, correlation_id
     ) VALUES (
       $1, 'platform_admin.password_rotated', 'user', $2, $3,
       'admin-password-cli'
     )`,
    [admin.rows[0].id, admin.rows[0].id, JSON.stringify({ email })],
  );
}

async function rotateV2(client, passwordHash) {
  const admin = await client.query(
    `SELECT id FROM platform_admin
     WHERE lower(email::text) = lower($1) AND status = 'ACTIVE'
     FOR UPDATE`,
    [email],
  );
  if (!admin.rowCount) throw new Error('Platform Super Admin was not found');

  await client.query(
    `UPDATE platform_admin
     SET password_hash = $2, last_active_at = now()
     WHERE id = $1`,
    [admin.rows[0].id, passwordHash],
  );
  await client.query(
    `UPDATE platform_admin_sessions
     SET session_status = 'REVOKED', revoked_at = now(),
         revoked_reason = 'Administrator password rotated'
     WHERE platform_admin_id = $1 AND session_status = 'ACTIVE'`,
    [admin.rows[0].id],
  );
  await client.query(
    `INSERT INTO audit_logs (
       platform_admin_id, role_code, action_type, record_type,
       record_id, new_value, result
     ) VALUES ($1, 'PLATFORM_SUPER_ADMIN', 'PLATFORM_ADMIN_PASSWORD_ROTATED',
       'PLATFORM_ADMIN', $1, $2, 'SUCCESS')`,
    [admin.rows[0].id, JSON.stringify({ email, sessionsRevoked: true })],
  );
}

async function main() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    const passwordHash = await hash(newPassword, 12);
    if (schemaVersion === 'v2') await rotateV2(client, passwordHash);
    else await rotateLegacy(client, passwordHash);
    await client.query('COMMIT');
    process.stdout.write(
      `Platform Super Admin password rotated for ${email}; active sessions revoked.\n`,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`Admin password rotation failed: ${error.message}\n`);
  process.exitCode = 1;
});
