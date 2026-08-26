# Phase 10 Production Hardening Validation

## Increment 1 - application rate limiting and trusted proxy boundary

Implemented:

- Redis-backed fixed-window limits are applied consistently across API replicas;
- login and refresh share a strict per-client policy and fail closed when Redis
  cannot enforce the limit;
- proof uploads use a separate strict policy and also fail closed;
- remaining application routes use a broader policy and fail open during a Redis
  incident so authenticated read/operational traffic is not completely cut off;
- liveness, readiness and metrics probes are exempt so orchestrators and responders
  can still diagnose a dependency incident;
- raw client addresses are SHA-256 hashed before they enter Redis keys;
- responses expose limit, remaining-window and reset headers, with `Retry-After` on
  HTTP 429 responses;
- Prometheus counters distinguish allowed, blocked and store-bypass decisions and
  count enforcement-store errors;
- proxy trust defaults to zero and is bounded by `TRUST_PROXY_HOPS` instead of
  trusting every forwarded address. Production requires the exact hop count;
- production configuration rejects `RATE_LIMIT_ENABLED=false`.

Default policies:

| Policy | Routes | Limit / 60 seconds | Store failure |
| --- | --- | ---: | --- |
| `auth` | login, refresh | 10 | fail closed |
| `upload` | transaction receipt upload | 20 | fail closed |
| `global` | other API routes | 300 | fail open and alert |

The defaults are starting safeguards, not final capacity values. Load rehearsal must
validate them against the expected NAT/mobile-client distribution and production
ingress limits. The WAF should enforce an outer volumetric limit; this application
layer remains the per-route defense and must not be removed when WAF rules are added.

Validation:

- policy tests cover probe exemptions, sensitive-route selection, general fallback
  and explicit non-production disablement;
- service tests cover quota accounting, address hashing, blocking and malformed
  Redis responses;
- guard tests cover response headers, HTTP 429, sensitive-route fail-closed behavior
  and general-route measured bypass;
- configuration tests cover defaults, bounded proxy hops and the production
  enforcement requirement.

## Increment 2 - multi-replica Redis load and outage rehearsal

`npm run test:phase10:rate-load` now exercises the production limiter implementation
against a real Redis instance through four independent application clients. The local
rehearsal completed with these results:

| Scenario | Requests | Allowed | Blocked | p99 |
| --- | ---: | ---: | ---: | ---: |
| Auth exact boundary | 11 | 10 | 1 | 10.01 ms |
| Upload exact boundary | 21 | 20 | 1 | 2.57 ms |
| Global exact boundary | 301 | 300 | 1 | 29.29 ms |
| Four-replica shared global quota | 301 | 300 | 1 | 25.07 ms |
| 100 independent mobile clients | 1,000 | 1,000 | 0 | 56.63 ms |
| One shared-NAT auth address | 50 | 10 | 40 | 2.86 ms |

The exercise also proves raw client addresses do not enter Redis keys. After an
intentional client disconnect, auth returned 503, general traffic returned 200, two
store errors were recorded, and the general bypass metric was emitted.

The initial run found and fixed a concurrent lazy-connection race: requests arriving
at cold start could issue `EVAL` while another request was still opening the shared
Redis socket. `RedisService.ensureConnected()` now shares one connection promise.

This closes the repeatable local Redis gate, but does not approve final production
thresholds. The shared-NAT result demonstrates that the 10/minute per-IP auth default
would reject 80% of a 50-request NAT burst. Approval therefore still requires the
expected production NAT distribution and either an accepted per-IP threshold or an
approved dual IP/account limiter, plus a real ingress/WAF exercise.

## Increment 3 - repository-history credential gate

`npm run test:phase10:history` scans added and removed lines from every commit reachable
through every local ref. It reports only commit, path and rule identifiers and never
prints a matched value. Secret-token/private-key patterns, deployment credential
assignments, production hard-coded secret properties, and full account numbers outside
explicit test-fixture paths fail the gate. Synthetic fixture account lines are counted
but not treated as production data.

The scan covered both reachable commits and 80,955 historical patch lines with zero
findings; 15 synthetic account-fixture lines were classified. CI now checks out full
history (`fetch-depth: 0`) and runs the same gate so shallow clones cannot silently pass.

## Increment 4 - root-discoverable backend CI gate

The previous backend workflow lived under `pay-guard-backend/.github/workflows`, which
GitHub does not discover because the Git repository root is its parent directory. It
has been replaced by `.github/workflows/backend-ci.yml` at the repository root.

The active workflow now:

- pins the supported Node 20.19.0 runtime and uses deterministic `npm ci`;
- fetches complete Git history and runs history, workspace-secret/static and production
  dependency scans;
- provisions healthy PostgreSQL 16 and Redis 7 services;
- runs lint, typecheck, 510 unit tests, legacy integration, V2 integration, the native
  PDF worker, production-sized report load and four-replica Redis load/outage gates;
- builds the production application after all validation succeeds;
- uses least-privilege read-only repository permissions, path filters, concurrency
  cancellation and a 45-minute timeout.

The local Node 24.19 Windows environment passes every non-native gate, including all
12 legacy integration tests. The PDF worker exits in its native canvas dependency on
this unsupported runtime, so the CI completion item remains open until the root
workflow runs on its pinned Node 20.19 Linux runner. The PDF gate was retained rather
than bypassed.

## Increment 5 - container deployment and rollback rehearsal

The production image now uses lockfile-driven `npm ci` in both stages, runs as the
unprivileged `node` user, includes both legacy and V2 migration assets, exposes a
Docker liveness health check, and carries the immutable source revision in the OCI
`org.opencontainers.image.revision` label. A revision-label-only rebuild reuses every
dependency and application layer.

`npm run test:phase10:rollback` is a guarded local rehearsal. It operates only on the
explicit `payguard-phase10-*-test` container names and requires externally supplied
test-service endpoints. It verifies both image contracts and distinct immutable image
IDs, starts the healthy baseline and checks liveness, proves a candidate with missing
configuration exits nonzero before receiving traffic, then restores the exact baseline
image and checks liveness again. Containers are removed in `finally` cleanup.

The rehearsal passed with the candidate rejected at exit code 1 and exact baseline
image identity restored. This validates the technical deployment/rollback mechanism;
the production gate still requires a recorded maintenance window, operator, approver
and rollback decision owner.

## Increment 6 - production release evidence gate

The remaining cutover inputs are now represented by one strict, redacted manifest.
Copy `docs/production-release-evidence.example.json` to the ignored
`production-release-evidence.json`, replace every placeholder using references from
the approved deployment systems, and run:

```powershell
npm run cutover:release-evidence
```

The validator requires an immutable image digest, bounded maintenance window, distinct
operator/approver/rollback owner, successful full CI run tied to a complete commit SHA,
repository-security and branch-protection proof, TLS/WAF/secret-manager evidence,
Verify.ET managed-key reference and webhook specification, receiving-account and
QR-sample approval counts, five production/staging drill records, and primary plus
secondary acknowledgements for five alert routes. All evidence links must use HTTPS.

The manifest rejects private keys, JWTs, common live-token formats and account-like
8-24 digit values. Validation failures print field paths and rules only. CI validates
the validator itself against a synthetic `.invalid`-domain fixture; it never claims
that fixture is production evidence. The incomplete template correctly returns NO-GO.

## Increment 7 - container supply-chain gate

Both Dockerfile stages now pin the Node 20 Alpine base by multi-platform digest. The
runtime stage upgrades Alpine packages before installing production dependencies,
then removes npm, npx, the npm package tree and npm's cache because package management
is not needed after the immutable image is built. The application still runs as the
unprivileged `node` user.

The first Docker Scout scan of the prior runtime found 2 critical and 25 high
vulnerabilities across 8 packages. They came from the base OpenSSL packages and npm's
bundled package-management toolchain, not the application dependency tree. After the
base refresh, Alpine security upgrade and runtime toolchain removal, the image contains
429 indexed packages and Docker Scout reports zero critical or high vulnerabilities.

The root CI workflow now builds the production Dockerfile in a dedicated job, rejects
any critical or high vulnerability, and separately generates an SPDX SBOM plus
max-level SLSA provenance. The two attestation JSON files must be non-empty and are
retained as CI artifacts for 30 days. The CI build uses the immutable commit SHA as the
OCI revision label.

The scan image and attestation export are deliberately separate. A locally loaded
Docker image cannot retain BuildKit attestations; the release pipeline must attach the
same SBOM and provenance when it pushes the immutable production digest to its approved
registry. Updating the pinned base digest is a reviewed maintenance operation and must
be followed by this gate and the deployment/rollback rehearsal.

## Increment 8 - deployable monitoring alerts

`monitoring/payguard.rules.yml` converts the Phase 9/10 runbook conditions into ten
deployable Prometheus alerts. It covers rate-limit store errors and bypass, an initial
blocked-request ratio threshold, Verify.ET provider pause and non-drain, and tick or
terminal failures for the Verify.ET, report, archive and notification workers.

Every alert has fixed severity, primary-role, secondary-role and runbook labels. The
expressions may use only the four fixed-cardinality metric families emitted by the
backend; the validation gate rejects sensitive or high-cardinality label terms. The
role labels intentionally contain no individual names so source does not become an
out-of-date personnel directory.

`npm run test:phase10:alerts` validates the complete inventory and routing contract.
`npm run test:phase10:alerts:promtool` additionally validates the YAML and PromQL with
the official Prometheus 3.13.1 `promtool` image pinned by multi-platform digest. Both
gates run in the root backend CI workflow.

This closes the deployable rule-definition gate only. Production monitoring must map
the roles to named primary and secondary people, deliver each synthetic alert, collect
both acknowledgements, and attach the secret-free exercise references to the release
evidence manifest.

## Increment 9 - Node 20 Linux native-runtime parity

`npm run test:phase10:linux-native` runs the native PDF worker, complete unit suite,
lint, typecheck and production build inside the exact Node 20.19 Debian Linux runtime
used as the hosted-CI compatibility target. The official image is pinned by its
multi-platform digest and the exercise explicitly selects `linux/amd64`.

The repository is mounted read-only and only required source/configuration assets are
copied into a 4 GiB ephemeral tmpfs. Dependency installation, native module loading,
tests and build outputs therefore cannot overwrite the developer's host `node_modules`
or working tree, and Docker removes the environment after the command exits.

This gate distinguishes an application/native-module incompatibility from the known
unsupported Windows/Node 24 environment. It strengthens local release evidence but
does not substitute for a successful hosted GitHub Actions run, whose URL and commit
SHA remain mandatory in the production release-evidence manifest.

The isolated rehearsal passed in 146 seconds: all 4 native PDF-worker cases and all
510 unit tests passed, followed by successful lint, typecheck and production build.

## Increment 10 - CI dependency immutability

Every external action in `.github/workflows/backend-ci.yml` is pinned to a full
40-character commit SHA. A human-readable major-version comment remains beside each
pin for maintenance context. The PostgreSQL and Redis service containers are also
pinned by multi-platform SHA-256 digest, so CI dependencies cannot change solely
because an upstream tag moves.

`npm run test:phase10:ci-supply-chain` recursively scans repository-root workflow
files and rejects external actions that use branches or tags, pins without version
comments, action publishers outside the approved `actions` and `docker` owners, and
service images without immutable digests. The backend CI runs this gate immediately
after deterministic dependency installation.

The gate currently validates one workflow, eleven external action invocations, two
service images and one API/worker container-contract invocation. Updating an action or
service image requires resolving and reviewing a
new immutable reference, changing the adjacent version comment when applicable, and
running the complete hosted workflow. Commit pinning protects resolution integrity;
it does not replace review of upstream release notes or the hosted CI evidence gate.

## Increment 11 - controlled dependency refresh

`.github/dependabot.yml` gives every immutable dependency surface a reviewed update
path. GitHub checks npm manifests and the production Dockerfile under
`/pay-guard-backend`, plus repository-root GitHub Actions, every Wednesday in the
`Africa/Addis_Ababa` time zone. Open version-update pull requests are bounded to ten
for npm and five each for Docker and Actions.

Npm production and development minor/patch updates are grouped separately; major
updates remain individual review units. Docker and GitHub Action updates also remain
individual so each new image digest or action commit can be reviewed. No dependency
allowlist or ignore rule is permitted.

The CI supply-chain validator requires all three ecosystems, their exact protected
directories, weekly schedule, bounded nonzero PR limits, commit prefixes and npm
grouping policy. It also rejects a custom target branch because Dependabot security
updates must continue to target the repository default branch.

This configuration creates reviewed update pull requests; it does not merge them or
bypass the complete backend workflow. The repository operator confirmed dependency
graph enablement on 2026-08-14. That statement is recorded as operator-reported because
this workspace has no authenticated GitHub settings client; retain an HTTPS settings
or audit reference with release evidence. Repository administrators must still enable
Dependabot alerts and security updates, protect the default branch, and require the
backend CI checks before merge.

## Increment 12 - pull-request dependency review

The operator-confirmed dependency graph now backs a dedicated pull-request-only job in
the root backend workflow. GitHub's official dependency-review action compares the
base and head dependency snapshots and fails when a pull request introduces a runtime
dependency with high or critical known vulnerabilities.

The action is pinned to the immutable v4.9.0 commit and runs under the workflow's
read-only `contents` permission. Pull-request comments are explicitly disabled, so the
job does not require `pull-requests: write`. Dependency changes remain visible in the
job log and GitHub dependency review UI.

The CI supply-chain validator requires exactly one dependency-review job, restricts it
to pull requests, and locks the high-severity/runtime/no-comment policy. Changes to
`.github/dependabot.yml` are included in the backend workflow path filter, ensuring the
maintenance policy itself receives the same validation.

This gate becomes merge-enforcing only when repository branch protection requires the
`dependency-review` check. Dependabot alerts and security updates remain independent
repository settings and are not inferred from dependency-graph enablement.

## Increment 13 - repository enforcement evidence

The release-evidence manifest now treats repository controls as cutover requirements,
not setup notes. Dependency graph, Dependabot alerts and Dependabot security updates
each require `PASS` plus an HTTPS settings or audit reference. Branch protection also
requires `PASS`, an evidence reference, and the exact `dependency-review`, `validate`
and `container` checks among its required status checks.

The branch policy evidence must show at least one approving review, stale-approval
dismissal, conversation resolution, blocked force pushes and blocked branch deletion.
The validator accepts additional required checks but rejects duplicate or malformed
check lists. CI evidence now requires the full 40-character commit SHA so the hosted
run, immutable image revision and reviewed source can be correlated unambiguously.

The valid synthetic fixture now exercises 73 evidence leaves. The production template
remains intentionally NO-GO until repository administrators attach real HTTPS evidence
and complete every external setting. The operator's dependency-graph confirmation is
recorded, but it cannot satisfy this final manifest without its retained reference.

## Increment 14 - independent API and worker image contracts

The production Dockerfile now exposes explicit `api` and `worker` targets over the
same hardened runtime. The API remains the default target, starts `dist/main.js` and
probes `/health/live`. The worker starts `dist/worker.js` and explicitly disables the
inherited HTTP health check because the worker process does not serve that endpoint.
This prevents an otherwise healthy worker from being continuously reported unhealthy
or restarted by a container platform expecting an API response.

`npm run test:phase10:container-contract` inspects both built images and fails unless
their commands and health behavior are role-correct. It also verifies the shared
production boundary: unprivileged `node` user, `NODE_ENV=production`, matching image
revision labels, removed npm CLI, and packaged legacy and V2 migration assets.

The root container job builds and vulnerability-scans both targets, executes the
runtime contract against the exact CI images, and generates separate max-level
provenance and SPDX SBOM artifacts for each. The supply-chain validator requires the
two-image contract invocation, so deleting it from CI fails the earlier validation
job as well.

## Increment 15 - independent production startup rehearsal

`npm run test:phase10:startup` proves that correct image metadata also produces
independently operable processes. The guarded PowerShell harness starts only the API,
waits for HTTP liveness and its structured startup event, removes it, then starts only
the worker and requires its structured startup event plus a stable running state.

Both roles are subsequently started with an invalid production setting and must exit
nonzero before serving or processing work. The harness injects distinct synthetic JWT,
account-encryption and archive-encryption markers and rejects either positive or
negative startup logs if any marker—or the configured object-storage secret—appears.

The exercise requires explicit `PHASE10_*` dependency URLs and object-storage
credentials, restricts its host port, and creates or removes only four fixed
`payguard-phase10-*-startup`/`*-invalid-config` container names. It does not create,
alter or remove the PostgreSQL, Redis or object-storage dependencies. The local
2026-08-14 rehearsal passed: both roles booted independently, both invalid starts
exited with code 1, and all configured secret markers were absent from logs.

## Increment 16 - correlated structured request logging

Every API request now emits one structured `request.completed` record containing only
correlation ID, HTTP method, controller route template, numeric status, bounded
duration and a coarse success/client-error/server-error outcome. Raw URLs, query
parameters, headers, cookies, authorization values, bodies and exception messages are
never included. Server errors use error severity, client errors warning severity and
successful requests the configured information level.

Correlation middleware is registered at the application-global boundary so it also
covers `/health/live`, `/health/ready` and `/metrics`, which are intentionally excluded
from the API prefix. Safe caller IDs are echoed in headers, response envelopes, logs
and audit context; unsafe IDs are replaced with UUIDs. Unit and HTTP integration tests
inject bearer, password, account and raw-payload markers and verify none reaches the
completion record.

`LOG_LEVEL` now controls Nest's API and worker logger thresholds instead of being
validation-only configuration. The complete-source Phase 9 leakage scan additionally
rejects any direct application-log access to request headers, body, raw URL or query,
along with its existing raw-error rules.

## Monitoring and incident handoff

Alert routing must be assigned to actual people in the deployment system before the
Phase 10 gate can close. Recommended alert rules:

| Signal | Initial condition | Owning role | Required response |
| --- | --- | --- | --- |
| `payguard_rate_limit_store_errors_total` | any sustained increase for 2 minutes | Backend on-call | Follow the Redis/rate-limit runbook; verify sensitive routes return 503 |
| `outcome="blocked"` | sharp increase or baseline anomaly | Security on-call | Correlate ingress/WAF source and auth failures; preserve sanitized evidence |
| `outcome="store_bypass"` | any increase for 2 minutes | Backend on-call | Treat as degraded protection and restore Redis before relaxing ingress controls |
| HTTP 429 ratio | exceeds approved load-test baseline | Product operations | Identify legitimate NAT concentration before changing limits |

Incident procedure:

1. Confirm `/health/live` is 200 and inspect `/health/ready`; do not disable the
   application limiter in production.
2. Confirm Redis reachability, latency, memory pressure, eviction policy and replica
   health. Rate-limit keys use the `payguard:rate-limit:` prefix and expire within one
   configured window.
3. Verify login, refresh and proof upload fail closed while the store is unavailable;
   verify general API traffic records `store_bypass`.
4. Tighten the outer WAF/ingress rule if bypass traffic is exposed to abuse. This is
   an infrastructure change requiring the deployment operator's approval.
5. Restore Redis and verify store-error/bypass counters stop increasing. Exercise a
   known non-production client until quota headers and HTTP 429 behavior recover.
6. Record the correlation window, affected policy, ingress action, recovery evidence
   and follow-up owner without storing tokens, account numbers or raw proof data.

Remaining production gates:

- enable Dependabot alerts/security updates and retain dependency-graph settings
  evidence; dependency-graph enablement was operator-confirmed on 2026-08-14;
- assign individual primary and secondary owners to the alert routes;
- exercise the rules against production-equivalent Redis and ingress/WAF;
- complete burst/load, queue outage and provider outage drills;
- complete encrypted backup restoration and managed archive-key recovery;
- dependency, secret, static-analysis and repository-history scans pass locally;
- API and worker container scans pass locally with zero critical/high findings; the
  hosted CI scans, runtime contract and four attestation artifact files remain required;
- local immutable-image deployment and rollback rehearsal passes; production approval,
  operator and rollback-owner evidence remain required.
- `cutover:release-evidence` blocks cutover until all external gates are documented in
  one complete, secret-free manifest.
