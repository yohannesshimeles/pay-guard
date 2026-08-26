# Phase 9 Session Validation

Implemented and validated:

- refresh tokens are stored as SHA-256 hashes and rotate with a compare-and-swap
  update, so the prior token cannot be replayed;
- logout revokes the persisted session and immediately invalidates access and refresh
  tokens;
- Waiter login serializes by user, revokes any prior active session and creates the
  replacement in one PostgreSQL transaction;
- migration `047_v2_waiter_session_serialization.sql` also serializes the database
  trigger, preventing concurrent direct writes from creating two active Waiter
  sessions;
- Manager, Owner, Cashier and Platform Super Admin sessions retain their existing
  multi-session behavior;
- automatic Waiter replacement records `AUTH_DEVICE_REPLACED` without storing the
  device identifier or token material;
- the replacement device notification continues to use the existing isolated Waiter
  device-event path.

Integration evidence:

- the first Waiter access token returns `401` after replacement;
- the first Waiter refresh token returns `401` after replacement;
- the replacement access token remains authorized;
- the prior row is `REVOKED` with an explicit replacement reason;
- exactly one active Waiter session and one replacement audit event remain;
- the complete clean V2 PostgreSQL suite passes through migration 047.
