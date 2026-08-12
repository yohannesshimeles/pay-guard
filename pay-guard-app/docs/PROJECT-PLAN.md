# PayGuard Android Project Plan

Source authority: Revised Compiled Project Plan, Version 2.0, July 2026.

Execution details and module-level completion checks are in
`MODULE-IMPLEMENTATION-CHECKLIST.md`.

## Phase 1 - Foundation

Deliver Gradle wrapper/version catalog, package/build variants, Compose navigation,
CameraX, ML Kit, Retrofit, Firebase abstraction, Keystore session store, design
components, lint/test tooling and Android CI.

Exit: repeatable debug build, tests and signed-test artifact succeed with no secret.

## Phase 2 - Authentication and device security

Deliver login, password reset, device registration, secure refresh, session-expired,
previous-device automatic logout and logout/profile shell.

Exit: second-phone login invalidates the first and the old app clears authenticated state.

## Phase 3 - Android MVP verification

Deliver Home, assigned branch/online status/counts, camera permission, scanner frame,
flash, QR decode, idempotent PayGuard submission, progress stages and every required
result state.

Exit: Waiter scans and verifies a test payment end to end through PayGuard.

## Phase 4 - History and notifications

Deliver own-history/counts only, pending status refresh, FCM registration, result/bank/
device/announcement notifications and authorized deep links.

Exit: pending results update without new verification/credit deduction and another
Waiter's transaction cannot be displayed.

## Phase 5 - Production hardening

Deliver lifecycle/network recovery, accessibility/device matrix, redacted telemetry,
release signing, shrinking, security tests, QR corpus, performance checks, staged
rollout and rollback/incident instructions.

Exit: Android test checklist and launch approval pass.

## External dependencies

- Backend authentication, device/session and Waiter-scoped APIs.
- Backend verification/pending event behavior and sanitized status contract.
- Final bank-specific QR samples.
- Android signing identity and Firebase project configuration.
- Privacy/data-handling approval.
