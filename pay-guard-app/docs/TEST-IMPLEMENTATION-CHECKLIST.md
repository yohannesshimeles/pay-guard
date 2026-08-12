# Android Test Implementation Checklist

Source authority: Revised Compiled Project Plan, Version 2.0, July 2026.

## Test foundation

- [ ] Configure Kotlin unit, coroutine/Flow, Compose UI and instrumented tests.
- [ ] Provide fake PayGuard API, network monitor, secure store, scanner and push client.
- [ ] Build a final approved QR fixture corpus for supported banks.
- [ ] Run debug build/unit tests in CI and instrumented tests on representative APIs.
- [ ] Verify release build contains no development HTTP logging or secret.

## Authentication and device

- [ ] Valid login registers the device and stores tokens through secure abstraction.
- [ ] Invalid credentials expose no account-enumeration detail.
- [ ] Password reset and session-expired state.
- [ ] Second-device login invalidates first-device session.
- [ ] Replaced-session API/push clears local credentials and protected UI.
- [ ] Logout clears credentials even if network revocation cannot complete immediately.
- [ ] App never contains Verify.ET or settlement account secrets.

## Scanner and verification unit tests

- [ ] Camera permission granted, denied and permanently denied.
- [ ] Stable QR frame emits once; duplicate frames do not resubmit.
- [ ] Supported-bank fixtures decode into expected safe submission fields.
- [ ] Malformed/oversized/unsupported QR is rejected safely.
- [ ] Offline Scan is blocked and no delayed verification is queued.
- [ ] Retry after uncertain response recovers the same verification ID/idempotency key.
- [ ] Unknown server status never maps to Verified.

## UI state tests

- [ ] Home shows assigned branch, online state and today's required counts only.
- [ ] Progress renders reading, bank detection, account loading, submitting,
  queued/running and waiting-for-bank states.
- [ ] Verified, Pending, Failed, Duplicate, Amount Mismatch, Wrong Account, Bank
  Unavailable, Provider Unavailable and Credits Exhausted states.
- [ ] Pending uses yellow plus accessible text/icon.
- [ ] History displays only own transaction models and counts.
- [ ] Profile shows identity/branch/device/version and password/logout actions.
- [ ] Notifications support pending completion/failure, bank unavailable, device
  logout and announcements.
- [ ] No balance, subscription plan or other employee transaction UI exists.

## Network and lifecycle integration

- [ ] Timeout before server acceptance permits safe retry.
- [ ] Connection loss after acceptance recovers status without a second initial request.
- [ ] 202 queued and payment pending update through polling/push without extra submission.
- [ ] Rotation/background/process recreation retains only safe opaque operation state.
- [ ] Token refresh rotation and revoked refresh behavior.
- [ ] Notification deep links validate current session and authorized transaction.
- [ ] Sensitive state is absent from recent-app/session restoration after logout.

## Critical end-to-end acceptance

- [ ] Waiter scan success consumes one backend branch credit, posts ledger once and
  displays push/result.
- [ ] Provider 202 queued displays processing and completes without duplicate deduction.
- [ ] Pending stays yellow and completes automatically.
- [ ] Duplicate payment does not show a second successful confirmation.
- [ ] Amount/account mismatch and bank/provider unavailable display correct safe result.
- [ ] Credits Exhausted stops ordinary customer verification.
- [ ] Second-phone login logs out the first phone.
- [ ] Waiter cannot retrieve another Waiter's transaction through modified deep-link ID.

## Security, accessibility and release

- [ ] Token/QR/reference/PII redaction across logs, crashes and analytics.
- [ ] Cleartext network disabled; exported component/deep-link review passes.
- [ ] Keystore storage and session wipe tested on supported API levels.
- [ ] TalkBack labels, logical focus, 48 dp targets and non-color statuses.
- [ ] Font scaling, orientation, low-memory/camera interruption and permission review.
- [ ] Startup/scanner/result performance meets agreed release threshold.
- [ ] Dependency, static-analysis, secret and APK inspection passes.
- [ ] Signing/Firebase production configuration is injected outside source control.
