# Phase 9 Audit Coverage Matrix

Scope: implemented PayGuard V2 mutations as of 2026-08-13. `AUDIT` means an
immutable `audit_logs` event; `HISTORY` means an immutable domain-history record
that supports reconstruction but still needs an audit event where marked.

| Area | Sensitive action | Evidence | Status |
|---|---|---|---|
| Authentication | Login, refresh, logout, automatic Waiter device replacement | `AUTH_LOGIN`, `AUTH_REFRESH`, `AUTH_LOGOUT`, `AUTH_DEVICE_REPLACED` | AUDIT |
| Identity | Staff creation and removal | `STAFF_CREATED`, `STAFF_REMOVED` | AUDIT |
| Identity | Password reset, role reassignment, explicit device-management command | Endpoints not implemented | FUTURE |
| Business | Registration and status decision | `BUSINESS_REGISTERED`, `BUSINESS_STATUS_CHANGED` | AUDIT |
| Branch | Create and update | `BRANCH_CREATED`, `BRANCH_UPDATED` | AUDIT |
| Banking | Bank and business/platform settlement-account changes | Bank/account audit events | AUDIT |
| Transaction | Authenticated transaction intake | `TRANSACTION_SUBMITTED` | AUDIT |
| Evidence | Receipt persistence after malware/QR inspection | `TRANSACTION_PROOF_UPLOADED` | AUDIT |
| Review | Receipt acknowledgement and resolution | `RECEIPT_REVIEW_ACKNOWLEDGED`, `RECEIPT_REVIEW_RESOLVED` | AUDIT |
| Verification | Successful verified payment posting | `VERIFIED_PAYMENT_POSTED` | AUDIT |
| Verification | Pending/failed outcome and recheck scheduling | `VERIFICATION_OUTCOME_PENDING`, `VERIFICATION_OUTCOME_FAILED` | AUDIT |
| Provider | Request reservation, send, success and failure | `PROVIDER_REQUEST_RESERVED`, `PROVIDER_REQUEST_SENT`, `PROVIDER_REQUEST_SUCCEEDED`, `PROVIDER_REQUEST_FAILED` | AUDIT |
| Provider | Retry and provider pause | `PROVIDER_RETRY_SCHEDULED`, `PROVIDER_RECHECK_PAUSED` | AUDIT |
| Provider | Signed webhook receive, processing and outcome | `PROVIDER_WEBHOOK_RECEIVED`, `PROVIDER_WEBHOOK_PROCESSING`, `PROVIDER_WEBHOOK_PROCESSED`, `PROVIDER_WEBHOOK_FAILED` | AUDIT |
| Provider | Incident acknowledgement | `VERIFYET_INCIDENT_ACKNOWLEDGED` | AUDIT |
| Financial | Manual Deposit, withdrawal, correction, reversal | Financial action audit IDs committed with ledger writes | AUDIT |
| Reconciliation | Create, submit, approve and return | Reconciliation action audit events and status history | AUDIT |
| Credit | Consumption, grant, defer, settle, expire and adjustment | Immutable `credit_transactions`; subscription decisions audited | HISTORY + AUDIT |
| Subscription | Purchase, proof, preparation and final decision | Subscription purchase/verification audit events | AUDIT |
| Fraud | Classification, lock, review and recovery authorization | Fraud decision and recovery audit events | AUDIT |
| Notification | Preference mutation | `NOTIFICATION_PREFERENCE_UPDATED` with before/after | AUDIT |
| Notification | Device registration and deactivation | `NOTIFICATION_DEVICE_REGISTERED`, `NOTIFICATION_DEVICE_DEACTIVATED` | AUDIT |
| Reports | Export request and download | `REPORT_EXPORT_REQUESTED`, `REPORT_EXPORT_DOWNLOADED` | AUDIT |
| Reports | Worker ready, retry, failed and expired transitions | `REPORT_EXPORT_READY`, `REPORT_EXPORT_RETRY_SCHEDULED`, `REPORT_EXPORT_FAILED`, `REPORT_EXPORT_EXPIRED` | AUDIT |
| Archive | Package, transfer and integrity verification | `ARCHIVE_BATCH_VERIFIED`, `ARCHIVE_BATCH_FAILED` | AUDIT |
| Archive | Active-source deletion and retry failure | `ARCHIVE_SOURCE_DELETED`, `ARCHIVE_SOURCE_DELETE_FAILED` | AUDIT |
| Archive | Authorized integrity-verified retrieval | `ARCHIVE_RECORD_RETRIEVED` plus retrieval history | AUDIT |

## Increment 2 closure

The authenticated mutation surface has no known unaudited sensitive action.
Idempotent transaction and report request replays do not duplicate their source
audit event. All newly instrumented events are committed through the same
`DaoTransaction` as the protected source record.

## Remaining finite audit work

1. Add password-reset, role and explicit device-replacement events with those future endpoints.
