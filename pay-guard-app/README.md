# PayGuard Android

Native Kotlin/Jetpack Compose application for the Waiter role.

The Waiter can log in on one active device, scan payment QR codes, follow live
PayGuard verification status, view personal transaction history and receive push
notifications. The application works only while online.

The app never stores Verify.ET keys or settlement account secrets, never calls
Verify.ET directly and never shows balances, subscription plans or other employees'
transactions.

## Technology

- Kotlin and Jetpack Compose
- CameraX
- ML Kit barcode scanning
- Retrofit
- Firebase Cloud Messaging
- Android Keystore-backed secure token storage

## Documentation

- `docs/ARCHITECTURE.md` - mobile modules, screens, state and security
- `docs/PROJECT-PLAN.md` - Android delivery phases and dependencies
- `docs/MODULE-IMPLEMENTATION-CHECKLIST.md` - implementation and expected result per module
- `docs/TEST-IMPLEMENTATION-CHECKLIST.md` - unit, QR, UI and E2E checklist
- `../docs/SOURCE-OF-TRUTH.md` - scope authority and application boundaries

Open this repository in Android Studio. Gradle wrapper, dependency catalog, CI and
build variants are Foundation tasks in the project plan.
