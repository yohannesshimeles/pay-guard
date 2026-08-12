# Android Module Implementation Checklist

Source authority: Revised Compiled Project Plan, Version 2.0, July 2026.

## Phase 1 - Android foundation module

Implementation:

- [ ] Add Gradle wrapper and version catalog.
- [ ] Configure Kotlin, Compose, CameraX, ML Kit, Retrofit and Firebase dependencies.
- [ ] Create debug/release build variants without embedded secrets.
- [ ] Create feature, core network, security, design and navigation packages.
- [ ] Add lint, unit, Compose UI, instrumented test and CI tasks.

Expected:

- [ ] Clean checkout builds and tests through the wrapper.
- [ ] Release configuration contains no Verify.ET/account secret.
- [ ] Feature modules depend on interfaces, not direct provider logic.

## Phase 1 - Mobile design module

Implementation:

- [ ] Build app bars, bottom navigation, buttons, fields, cards, status/result panels,
  transaction rows, progress, loading, empty, error and dialog components.
- [ ] Add 48 dp targets, TalkBack descriptions and non-color statuses.
- [ ] Build online/offline, session-expired and device-replaced surfaces.

Expected:

- [ ] All screens use consistent Compose components.
- [ ] Status remains understandable with color disabled and font scaling enabled.

## Phase 2 - Authentication module

Implementation:

- [ ] Build login and password reset screens.
- [ ] Implement Retrofit auth calls and sanitized failures.
- [ ] Store rotated session credentials with Keystore-backed secure storage.
- [ ] Register device during login.
- [ ] Implement session refresh, expiry and logout.

Expected:

- [ ] Waiter reaches only the assigned authenticated experience.
- [ ] Credentials are absent from logs, state restoration and normal preferences.

Completion:

- [ ] Login/reset/refresh/logout and secure-storage tests pass.

## Phase 2 - One-device session module

Implementation:

- [ ] Handle second-phone activation response.
- [ ] Handle replacement push and replacement API/refresh error.
- [ ] Clear credentials and protected state immediately.
- [ ] Show specific previous-device logout/session-replaced explanation.

Expected:

- [ ] Only one Waiter device remains active.
- [ ] Correctness does not depend on push delivery.

Completion:

- [ ] Two-device backend E2E test passes.

## Phase 3 - Navigation and Home module

Implementation:

- [ ] Build bottom navigation: Home, Scan, History, Notifications and Profile.
- [ ] Display Waiter identity, assigned branch and online state.
- [ ] Display today's transaction, verified, pending and failed counts.
- [ ] Display own recent transactions and large Scan Payment action.

Expected:

- [ ] Home requests no settlement balance, subscription plan or other staff data.
- [ ] New Scan is unavailable while offline.

## Phase 3 - QR Scanner module

Implementation:

- [ ] Request camera permission in context.
- [ ] Build preview, guide frame, flash and bank-detection feedback.
- [ ] Integrate CameraX image analysis and ML Kit barcode decoding.
- [ ] Debounce stable QR and stop duplicate frame submission.
- [ ] Validate only safe shape/size locally.
- [ ] Submit raw required data only to PayGuard over HTTPS.

Expected:

- [ ] QR is submitted exactly once per user scan.
- [ ] App never calls Verify.ET or decides receiver/payment validity.
- [ ] Malformed/unsupported QR produces safe retry guidance.

Completion:

- [ ] Approved bank QR corpus and permission/device tests pass.

## Phase 3 - Verification submission module

Implementation:

- [ ] Create an idempotency key for the initial PayGuard request.
- [ ] Retain opaque verification ID for status recovery.
- [ ] Handle connection loss before/after server acceptance.
- [ ] Recover existing status rather than submitting again.

Expected:

- [ ] Network/lifecycle uncertainty cannot create an extra initial credit deduction.
- [ ] No local code path can mark a payment Verified.

## Phase 3 - Verification progress module

Implementation:

- [ ] Render Reading QR, Detecting bank, Loading settlement account, Submitting,
  API queued/running and Waiting for bank.
- [ ] Poll or consume PayGuard updates for the same verification ID.
- [ ] Preserve safe progress across rotation/backgrounding.

Expected:

- [ ] Queued and pending states remain visible until PayGuard returns a terminal result.
- [ ] Automatic progress updates never create a new submission.

## Phase 3 - Verification results module

Implementation:

- [ ] Build Verified result.
- [ ] Build yellow Pending result with automatic-recheck message.
- [ ] Build Failed and Duplicate results.
- [ ] Build Amount Mismatch and Wrong Account results.
- [ ] Build Bank Unavailable, Provider Unavailable and Credits Exhausted.
- [ ] Render only sanitized PayGuard fields.

Expected:

- [ ] Every PDF-defined result is distinct and accessible.
- [ ] Duplicate exposes no confidential business information.
- [ ] Credits Exhausted blocks ordinary verification.

Completion:

- [ ] All provider simulator outcomes pass UI and backend E2E tests.

## Phase 4 - History module

Implementation:

- [ ] Fetch Waiter's own transactions and counts only.
- [ ] Build list, state indicators and authorized detail.
- [ ] Refresh pending transaction status.
- [ ] Handle empty, loading, offline and session-replaced states.

Expected:

- [ ] Modified IDs cannot display another Waiter's transaction.
- [ ] Cached history is never presented as a new/current verification decision.

## Phase 4 - Notifications module

Implementation:

- [ ] Register/update Firebase token through PayGuard.
- [ ] Handle pending completed/failed.
- [ ] Handle bank unavailable, device replacement and announcements.
- [ ] Validate session and scope before opening a notification detail.
- [ ] Use safe/opaque payload data.

Expected:

- [ ] Push accelerates updates but API authorization remains authoritative.
- [ ] Notification content contains no settlement secret or sensitive raw receipt.

## Phase 4 - Profile module

Implementation:

- [ ] Display identity, assigned business/branch, phone, active device and app version.
- [ ] Build password change and logout.
- [ ] Clear secure session state on logout even if network is unavailable.

Expected:

- [ ] Profile contains no balance, plan or other staff information.

## Phase 5 - Network and lifecycle hardening

Implementation:

- [ ] Disable cleartext traffic and review certificate-pinning decision.
- [ ] Add timeouts and safe retry only where idempotency allows.
- [ ] Test rotation, background, process recreation, camera interruption and low memory.
- [ ] Redact tokens, QR values, references and PII from network/crash telemetry.

Expected:

- [ ] User sees accurate offline/uncertain state without false verification success.
- [ ] Sensitive information is not restored after logout/replacement.

## Phase 5 - Accessibility and device readiness

Implementation:

- [ ] Add TalkBack labels and ordered navigation.
- [ ] Verify 48 dp targets, font scaling and non-color status meaning.
- [ ] Test camera permission denied/permanently denied.
- [ ] Test supported API levels, screen sizes and physical camera behavior.

Expected:

- [ ] Core Scan and result journey is usable with accessibility services.

## Phase 5 - Release readiness

- [ ] Android signing identity and Firebase production project are configured outside Git.
- [ ] Unit, QR corpus, Compose UI, instrumented and backend E2E suites pass.
- [ ] Release APK/AAB inspection finds no provider secret or debug logging.
- [ ] Startup/scanner/result performance checks pass.
- [ ] Staged rollout, monitoring and rollback instructions are approved.
