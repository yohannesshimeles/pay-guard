BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE user_status AS ENUM ('ACTIVE', 'INACTIVE', 'REMOVED');
CREATE TYPE role_code AS ENUM (
  'PLATFORM_SUPER_ADMIN',
  'BUSINESS_OWNER',
  'MANAGER',
  'CASHIER',
  'WAITER'
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  phone text UNIQUE,
  password_hash text NOT NULL,
  status user_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_identity_required CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE TABLE roles (
  code role_code PRIMARY KEY,
  name text NOT NULL
);

INSERT INTO roles (code, name) VALUES
  ('PLATFORM_SUPER_ADMIN', 'Platform Super Admin'),
  ('BUSINESS_OWNER', 'Business Owner'),
  ('MANAGER', 'Manager'),
  ('CASHIER', 'Cashier'),
  ('WAITER', 'Waiter');

CREATE TABLE permissions (
  code text PRIMARY KEY,
  description text NOT NULL
);

CREATE TABLE role_permissions (
  role_code role_code NOT NULL REFERENCES roles(code),
  permission_code text NOT NULL REFERENCES permissions(code),
  PRIMARY KEY (role_code, permission_code)
);

CREATE TABLE businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE business_owners (
  business_id uuid NOT NULL REFERENCES businesses(id),
  user_id uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (business_id, user_id)
);

CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE branch_user_assignments (
  branch_id uuid NOT NULL REFERENCES branches(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role_code role_code NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, user_id),
  CONSTRAINT branch_role_only CHECK (role_code IN ('MANAGER', 'CASHIER', 'WAITER'))
);

CREATE UNIQUE INDEX one_active_branch_per_operational_user
  ON branch_user_assignments (user_id)
  WHERE active;

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id),
  role_code role_code NOT NULL REFERENCES roles(code),
  PRIMARY KEY (user_id, role_code)
);

CREATE UNIQUE INDEX one_role_per_user ON user_roles (user_id);

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  device_identifier_hash text NOT NULL,
  platform text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX one_active_waiter_device
  ON devices (user_id)
  WHERE active;

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  device_id uuid REFERENCES devices(id),
  refresh_token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id),
  business_id uuid REFERENCES businesses(id),
  branch_id uuid REFERENCES branches(id),
  action text NOT NULL,
  target_type text,
  target_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_scope_time
  ON audit_logs (business_id, branch_id, created_at DESC);

COMMIT;
