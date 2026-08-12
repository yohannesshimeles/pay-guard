# PayGuard Android Architecture

Source authority: Revised Compiled Project Plan, Version 2.0, July 2026.

## 1. Application boundary

The Android app is exclusively for Waiters. It:

- Authenticates and registers one active Waiter device.
- Shows assigned branch, online status and today's counts.
- Scans/decodes payment QR codes.
- Submits verification to the PayGuard backend.
- Shows live progress and sanitized outcomes.
- Shows only the Waiter's own transaction history/counts.
- Receives pending-result, bank, session and announcement notifications.

It does not call Verify.ET, contain provider/account secrets, support offline
verification, show balances/subscriptions or expose another employee's transactions.

## 2. Technical architecture

Use Kotlin, Jetpack Compose, CameraX, ML Kit barcode scanning, Retrofit and Firebase
Cloud Messaging.

```text
app/
  core/
    design/
    network/
    security/
    model/
  feature/
    authentication/
    home/
    scanner/
    verification/
    history/
    notifications/
    profile/
  navigation/
```

Feature ViewModels expose immutable UI state and invoke repositories. Repositories
call PayGuard through Retrofit. Compose renders state and emits user actions; it does
not implement verification decisions. Camera decoding is isolated behind a scanner
interface so QR fixtures can be tested without physical camera hardware.

## 3. Authentication and session architecture

Screens/states: login, password reset, device registration, previous-device automatic
logout and session expired.

On second-phone login, the backend invalidates the previous device session. Push may
notify the first device, but any later API/refresh response also enforces replacement.
The app clears local session state and displays a specific device-logout message.

Short-lived access and rotated refresh credentials follow backend behavior. Tokens are
stored through Android Keystore-backed secure storage. No provider secret is present
in code, resources, APK or remote config.

## 4. Screen and navigation architecture

Authenticated bottom navigation:

- Home
- Scan
- History
- Notifications
- Profile

### Home

Displays Waiter identity, assigned branch, online status, today's transaction/
verified/pending/failed counts, recent own transactions and a large Scan Payment
action. No monetary balance or other staff data is requested.

### QR Scanner

1. Request camera permission in context.
2. Show guide frame, flash control and bank-detection feedback.
3. Decode using ML Kit.
4. Validate only basic payload shape and online availability locally.
5. Stop repeated frame processing after stable detection.
6. Submit one idempotent request to PayGuard.

QR content is untrusted. The backend repeats parsing, bank adapter selection and all
matching. The app neither edits decoded settlement values nor interprets provider
success independently.

### Progress

Render PayGuard states:

- Reading QR
- Detecting bank
- Loading settlement account
- Submitting
- API queued/running
- Waiting for bank

If the response is uncertain because of lifecycle/network interruption, recover the
same verification ID; do not create a new initial request and credit deduction.

### Results

Supported outcomes:

- Verified
- Pending
- Failed
- Duplicate
- Amount Mismatch
- Wrong Account
- Bank Unavailable
- Provider Unavailable
- Credits Exhausted

Pending is yellow with text and remains in automatic recheck. Results are sanitized
PayGuard responses. Duplicate displays no confidential information. Credits Exhausted
stops ordinary verification.

### History

The backend scopes the list to the authenticated Waiter's own transactions/counts.
History supports status/time navigation needed by the product, including pending
updates, but never uses locally cached data as a new verification decision.

### Notifications

Firebase push events: pending completed/failed, bank unavailable, device session
replaced and announcements. Push payloads carry safe display content/opaque IDs;
opening a notification fetches authorized detail from PayGuard.

### Profile

Shows identity, assigned business/branch, phone, active device and app version, with
password change and logout. Logout revokes the session when reachable and always
clears local secure credentials.

## 5. State and connectivity

The app is online-only. New Scan is unavailable without connectivity and nothing is
queued for later verification. Connectivity pre-check is advisory; network races are
handled as unknown/pending operation recovery.

ViewModels use explicit loading/content/empty/error/session-replaced states. Saved
state may retain opaque verification IDs but not raw QR, passwords or tokens.
Unknown backend status renders a safe service error rather than guessing an outcome.

## 6. Security and privacy

- HTTPS for PayGuard connections; evaluate certificate pinning with a rotation plan.
- Android Keystore-backed token storage and immediate wipe on logout/replacement.
- No cleartext traffic or provider credentials.
- Redact tokens, QR content, full references and personal data from HTTP/crash logs.
- No settlement account secrets or sensitive provider debug responses in models.
- Restrict exported Android components and validate notification/deep-link IDs.
- Camera permission only; do not request unnecessary storage/contact/location access.
- Release signing keys are protected and absent from the repository.
- Backend remains authoritative for one-device session, branch scope and history.

## 7. Observability

Capture redacted crash/performance data for startup, login, scanner initialization,
submission, queued/pending duration, notification delivery and session replacement.
Correlate support issues through safe backend correlation IDs. Never attach raw QR or
authentication material.

## 8. Accessibility and device behavior

Scanner controls, bottom navigation and results have TalkBack descriptions and at
least 48 dp touch targets. Status uses icon/text in addition to color. Support font
scaling, rotation/lifecycle restoration, permission denial, camera interruption and
common supported Android sizes. The online state is clearly announced.
