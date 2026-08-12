# Database Connection Pooling and Reset Handling

## Runtime behavior

`DatabaseService` owns the PostgreSQL pool. `CentralDao` and feature DAOs use that
service rather than creating additional pools.

The pool is configured to:

- use TCP keepalive to detect dead network paths;
- bound connection acquisition, query and PostgreSQL statement time;
- retire connections after a maximum use count and lifetime;
- remove idle clients that emit connection errors without crashing the process;
- destroy a transaction client after `ECONNRESET`, `EPIPE`, timeout, PostgreSQL
  connection-class (`08xxx`) or server-shutdown errors;
- preserve the original transaction error if rollback also fails.

Writes and transactions are never automatically retried after a connection reset.
The server may have committed a request before the client observed the disconnect,
so blind retry could duplicate a financial effect. Retry belongs at an idempotent
application command boundary with a persisted idempotency key.

## Configuration

```env
DATABASE_POOL_MAX=20
DATABASE_IDLE_TIMEOUT_MS=30000
DATABASE_CONNECTION_TIMEOUT_MS=5000
DATABASE_QUERY_TIMEOUT_MS=30000
DATABASE_STATEMENT_TIMEOUT_MS=30000
DATABASE_KEEPALIVE_INITIAL_DELAY_MS=10000
DATABASE_MAX_USES=5000
DATABASE_MAX_LIFETIME_SECONDS=1800
```

These are safe application defaults, not a substitute for production capacity
planning. Calculate each production instance's pool limit as:

```text
floor((PostgreSQL max_connections - admin/monitoring reserve) / maximum API+worker instances)
```

Keep a reserve for migrations, operations, monitoring and incident access. Count
API and worker processes separately because every process owns a pool.

## Operational checks

- Alert on connection acquisition timeout and idle-client error events.
- Compare total API/worker pool capacity with PostgreSQL `max_connections` before
  scaling replicas.
- Monitor active, idle, waiting and long-running sessions.
- Use an external connection proxy such as PgBouncer only after validating session
  and transaction semantics.
- Investigate recurring resets at PostgreSQL, proxy, firewall and container/network
  layers; pool recovery prevents a stale client from being reused but does not hide
  infrastructure faults.
