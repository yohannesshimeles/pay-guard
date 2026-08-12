import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { hash } from 'bcryptjs';
import { Pool } from 'pg';
import { AppModule } from '../../src/app.module';
import { V2AuditService } from '../../src/audit/v2-audit.service';
import { V2AuthRepository } from '../../src/auth/v2-auth.repository';
import { V2SessionRepository } from '../../src/auth/v2-session.repository';
import {
  AppConfig,
  DEFAULT_CLAMAV_CONFIG,
  DEFAULT_DATABASE_POOL_CONFIG,
  DEFAULT_VERIFYET_CONFIG,
} from '../../src/config/app-config';
import { DatabaseService } from '../../src/database/database.service';
import { configureApplication } from '../../src/bootstrap';
import { VerificationAttemptType } from '../../src/verifications/enums/verification-attempt-type.enum';
import { VerificationAttemptResult } from '../../src/verifications/enums/verification-attempt-result.enum';
import { VerificationPreparationService } from '../../src/verifications/verification-preparation.service';
import { PendingRecheckDao } from '../../src/verifications/pending-recheck.dao';
import { PendingRecheckCoordinatorService } from '../../src/verifications/pending-recheck-coordinator.service';
import { VerificationOutcomeService } from '../../src/verifications/verification-outcome.service';
import { VerifiedPaymentPostingService } from '../../src/verifications/verified-payment-posting.service';
import { TransactionQueryService } from '../../src/transactions/transaction-query.service';
import { LedgerPostingService } from '../../src/ledger/ledger-posting.service';
import { LedgerEntryType } from '../../src/ledger/ledger-entry-type.enum';
import { CreditLifecycleService } from '../../src/credits/credit-lifecycle.service';
import { CentralDao } from '../../src/database/central.dao';
import { ReportExportDao } from '../../src/reports/report-export.dao';
import { SubscriptionVerificationDao } from '../../src/subscriptions/subscription-verification.dao';
import {
  SubscriptionPurchaseDao, SubscriptionPurchaseLockedError,
} from '../../src/subscriptions/subscription-purchase.dao';
import { deterministicUuid } from '../../src/common/deterministic-uuid';
import { FraudReviewDao } from '../../src/fraud/fraud-review.dao';
import {
  RecoveryAuthorizationDao, RecoveryAuthorizationInvalidError,
} from '../../src/fraud/recovery-authorization.dao';
import { TransactionReceiptDao } from '../../src/qr-processing/transaction-receipt.dao';
import { ProofMimeType } from '../../src/qr-processing/enums/proof-mime-type.enum';

const databaseUrl = process.env.TEST_V2_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const config: AppConfig = {
  firebase: { enabled: false, timeoutMs: 8_000 },
  notificationWorkerPollMs: 2_000,
  environment: 'test',
  port: 0,
  logLevel: 'error',
  databaseSchemaVersion: 'v2',
  databaseUrl: databaseUrl!,
  databasePool: DEFAULT_DATABASE_POOL_CONFIG,
  clamav: DEFAULT_CLAMAV_CONFIG,
  verifyEt: DEFAULT_VERIFYET_CONFIG,
  redisUrl: 'redis://127.0.0.1:6399',
  jwtAccessSecret:
    'v2-integration-secret-that-is-longer-than-thirty-two-characters',
  accountEncryptionKey:
    'v2-integration-account-key-that-is-longer-than-thirty-two-characters',
  jwtAccessTtlSeconds: 900,
  refreshTokenTtlSeconds: 3600,
  passwordResetTtlSeconds: 300,
  s3: {
    endpoint: 'http://127.0.0.1:9199',
    region: 'us-east-1',
    bucket: 'payguard-v2-test',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret-at-least-sixteen',
    forcePathStyle: true,
  },
};

function responseData<T>(response: { json(): unknown }): T {
  const body = response.json();
  if (typeof body !== 'object' || body === null || !('data' in body)) {
    throw new Error('Expected a PayGuard success response');
  }
  return (body as { data: T }).data;
}

describeWithDatabase('V2 authentication persistence', () => {
  const pool = new Pool({ connectionString: databaseUrl });
  let database: DatabaseService;
  let identities: V2AuthRepository;
  let sessions: V2SessionRepository;
  let audit: V2AuditService;
  let verificationPreparation: VerificationPreparationService;
  let verificationOutcomes: VerificationOutcomeService;
  let verifiedPaymentPosting: VerifiedPaymentPostingService;
  let pendingRechecks: PendingRecheckDao;
  let pendingRecheckCoordinator: PendingRecheckCoordinatorService;
  let transactionQueries: TransactionQueryService;
  let ledgerPostings: LedgerPostingService;
  let creditLifecycle: CreditLifecycleService;
  let centralDao: CentralDao;
  let subscriptionVerifications: SubscriptionVerificationDao;
  let subscriptionPurchases: SubscriptionPurchaseDao;
  let fraudReviews: FraudReviewDao;
  let recoveryAuthorizations: RecoveryAuthorizationDao;
  let app: NestFastifyApplication;
  let userId: string;
  let adminId: string;
  let membershipId: string;
  let membershipRoleId: string;
  let workAssignmentId: string;
  let businessId: string;
  let branchId: string;
  let receiptReviewCaseId: string;
  let reviewedTransactionId: string;
  let verificationOutcomeTransactionId: string;

  beforeAll(async () => {
    const current = await pool.query<{ name: string }>(
      'SELECT current_database() AS name',
    );
    if (!current.rows[0]?.name.endsWith('_test')) {
      throw new Error('V2 integration requires a database ending in _test');
    }

    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');
    for (const migration of [
      '001_payguard_v2_initial.sql',
      '002_v2_secure_sessions.sql',
      '003_v2_platform_admin_audit.sql',
      '004_v2_verifyet_request_history.sql',
      '005_v2_verifyet_webhook_deliveries.sql',
      '006_v2_verification_transition_source.sql',
      '007_v2_branch_credit_wallets.sql',
      '008_v2_verification_attempt_idempotency.sql',
      '009_v2_pending_recheck_claims.sql',
      '010_v2_verification_attempt_outcomes.sql',
      '011_v2_verified_payment_posting.sql',
      '012_v2_verifyet_provider_incidents.sql',
      '013_v2_verifyet_incident_acknowledgement.sql',
      '014_v2_transaction_query_indexes.sql',
      '015_v2_transaction_submission_idempotency.sql',
      '016_v2_receipt_match_decisions.sql',
      '017_v2_receipt_review_operational_index.sql',
      '018_v2_receipt_review_cases.sql',
      '019_v2_ledger_posting_foundation.sql',
      '020_v2_manual_deposit_intake.sql',
      '021_v2_cashier_withdrawals.sql',
      '022_v2_manager_financial_controls.sql',
      '023_v2_daily_reconciliation_workflow.sql',
      '024_v2_reconciliation_created_at.sql',
      '025_v2_reconciliation_manager_decisions.sql',
      '026_v2_reconciliation_history_order.sql',
      '027_v2_credit_lot_foundation.sql',
      '028_v2_canonical_credit_branch_scope.sql',
      '029_v2_credit_lifecycle.sql',
      '030_v2_deferred_credit_integrity.sql',
      '031_v2_subscription_purchase_intake.sql',
      '032_v2_subscription_transition_compatibility.sql',
      '033_v2_subscription_verification.sql',
      '034_v2_subscription_invoices.sql',
      '035_v2_subscription_fraud_foundation.sql',
      '036_v2_subscription_fraud_alerts.sql',
      '037_v2_recovery_authorization.sql',
      '038_v2_notification_foundation.sql',
      '039_v2_notification_delivery.sql',
      '040_v2_notification_recipient_matrix.sql',
      '041_v2_financial_notifications.sql',
      '042_v2_financial_report_index.sql',
      '043_v2_operational_report_indexes.sql',
      '044_v2_report_export_lifecycle.sql',
      '045_v2_audit_query_foundation.sql',
    ]) {
      await pool.query(
        await readFile(
          join(process.cwd(), 'database', 'initial', migration),
          'utf8',
        ),
      );
    }

    const [managerPasswordHash, adminPasswordHash] = await Promise.all([
      hash('V2-Manager-Integration-Password!', 4),
      hash('V2-Admin-Integration-Password!', 4),
    ]);
    const seeded = await pool.query<{
      user_id: string;
      admin_id: string;
      membership_id: string;
      membership_role_id: string;
      work_assignment_id: string;
      business_id: string;
      branch_id: string;
    }>(
      `
      WITH app_user AS (
        INSERT INTO users (
          full_name, phone_number, email, password_hash, global_status
        ) VALUES (
          'V2 Manager', '+251911000001', 'v2-manager@example.test',
          $1, 'ACTIVE'
        ) RETURNING id
      ), business AS (
        INSERT INTO businesses (
          business_code, legal_name, category_id, tin, phone,
          address, city, status, activation_at
        ) SELECT
          'V2-TEST-001', 'V2 Test Business', id, 'TIN-V2-TEST-001',
          '+251911000002', 'Test address', 'Addis Ababa', 'ACTIVE', now()
        FROM business_categories WHERE name = 'Coffee House'
        RETURNING id
      ), membership AS (
        INSERT INTO business_user_memberships (
          user_id, business_id, status, joined_at, approved_at
        ) SELECT app_user.id, business.id, 'ACTIVE', now(), now()
        FROM app_user, business RETURNING id, user_id, business_id
      ), role_assignment AS (
        INSERT INTO membership_role_assignments (
          membership_id, role_code, status, approved_at, assigned_at
        ) SELECT id, 'MANAGER', 'ACTIVE', now(), now()
        FROM membership RETURNING id, membership_id
      ), branch AS (
        INSERT INTO branches (
          branch_code, business_id, branch_name, address, city,
          sub_city, woreda, location_details, status,
          created_by_membership_id, activated_at
        ) SELECT
          'V2-BRANCH-001', business.id, 'V2 Branch', 'Branch address',
          'Addis Ababa', 'Bole', '03', 'Integration test branch',
          'ACTIVE', membership.id, now()
        FROM business, membership RETURNING id, business_id
      ), work_assignment AS (
        INSERT INTO user_work_assignments (
          membership_role_id, business_id, assignment_type, branch_id,
          status, is_primary_context, approved_at, assigned_at
        ) SELECT
          role_assignment.id, business.id, 'BRANCH', branch.id,
          'ACTIVE', true, now(), now()
        FROM role_assignment, business, branch
        RETURNING id, membership_role_id, business_id, branch_id
      ), admin AS (
        INSERT INTO platform_admin (
          full_name, phone_number, email, password_hash, job_title
        ) VALUES (
          'V2 Test Admin', '+251911000003', 'v2-admin@example.test',
          $2, 'Test Administrator'
        ) RETURNING id
      )
      SELECT
        app_user.id AS user_id,
        admin.id AS admin_id,
        membership.id AS membership_id,
        role_assignment.id AS membership_role_id,
        work_assignment.id AS work_assignment_id,
        business.id AS business_id,
        branch.id AS branch_id
      FROM app_user, admin, membership, role_assignment,
           work_assignment, business, branch
    `,
      [managerPasswordHash, adminPasswordHash],
    );
    const row = seeded.rows[0];
    userId = row.user_id;
    adminId = row.admin_id;
    membershipId = row.membership_id;
    membershipRoleId = row.membership_role_id;
    workAssignmentId = row.work_assignment_id;
    businessId = row.business_id;
    branchId = row.branch_id;

    database = new DatabaseService(config);
    identities = new V2AuthRepository(database);
    sessions = new V2SessionRepository(database);
    audit = new V2AuditService(database);

    app = await NestFactory.create<NestFastifyApplication>(
      AppModule.register(config),
      new FastifyAdapter(),
      { logger: false },
    );
    configureApplication(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    verificationPreparation = app.get(VerificationPreparationService);
    verificationOutcomes = app.get(VerificationOutcomeService);
    verifiedPaymentPosting = app.get(VerifiedPaymentPostingService);
    pendingRechecks = app.get(PendingRecheckDao);
    pendingRecheckCoordinator = app.get(PendingRecheckCoordinatorService);
    transactionQueries = app.get(TransactionQueryService);
    ledgerPostings = app.get(LedgerPostingService);
    creditLifecycle = app.get(CreditLifecycleService);
    centralDao = app.get(CentralDao);
    subscriptionVerifications = app.get(SubscriptionVerificationDao);
    subscriptionPurchases = app.get(SubscriptionPurchaseDao);
    fraudReviews = app.get(FraudReviewDao);
    recoveryAuthorizations = app.get(RecoveryAuthorizationDao);
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    if (database) await database.onApplicationShutdown();
    await pool.end();
  });

  it('loads an exact active membership, role and branch context', async () => {
    await expect(
      identities.findIdentity('v2-manager@example.test'),
    ).resolves.toMatchObject({
      id: userId,
      identityType: 'BUSINESS_USER',
      status: 'ACTIVE',
      contexts: [
        {
          membershipId,
          membershipRoleId,
          workAssignmentId,
          role: 'MANAGER',
          businessId,
          branchId,
        },
      ],
    });
  });

  it('creates, validates and atomically rotates a business refresh token', async () => {
    const created = await sessions.createBusinessSession({
      userId,
      membershipId,
      membershipRoleId,
      workAssignmentId,
      refreshTokenHash: 'a'.repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
      deviceIdentifierHash: 'd'.repeat(64),
      devicePlatform: 'web',
    });

    await expect(
      sessions.isActive({
        sessionKind: 'BUSINESS_USER',
        sessionId: created.sessionId,
        subjectId: userId,
      }),
    ).resolves.toBe(true);
    await expect(
      sessions.rotateRefreshToken({
        sessionKind: 'BUSINESS_USER',
        sessionId: created.sessionId,
        currentHash: 'a'.repeat(64),
        nextHash: 'b'.repeat(64),
        nextExpiry: new Date(Date.now() + 120_000),
      }),
    ).resolves.toBe(true);
    await expect(
      sessions.findActiveByRefreshTokenHash('a'.repeat(64)),
    ).resolves.toBeUndefined();
    await expect(
      sessions.findActiveByRefreshTokenHash('b'.repeat(64)),
    ).resolves.toMatchObject({ id: created.sessionId, role: 'MANAGER' });
    await sessions.revoke({
      sessionKind: 'BUSINESS_USER',
      sessionId: created.sessionId,
      subjectId: userId,
      reason: 'Integration test cleanup',
    });
  });

  it('enforces one active Waiter session at the database boundary', async () => {
    const waiterRole = await pool.query<{ id: string }>(
      `INSERT INTO membership_role_assignments (
         membership_id, role_code, status, approved_at, assigned_at
       ) VALUES ($1, 'WAITER', 'ACTIVE', now(), now()) RETURNING id`,
      [membershipId],
    );
    const waiterAssignment = await pool.query<{ id: string }>(
      `INSERT INTO user_work_assignments (
         membership_role_id, business_id, assignment_type, branch_id,
         status, approved_at, assigned_at
       ) VALUES ($1, $2, 'BRANCH', $3, 'ACTIVE', now(), now()) RETURNING id`,
      [waiterRole.rows[0].id, businessId, branchId],
    );
    const input = {
      userId,
      membershipId,
      membershipRoleId: waiterRole.rows[0].id,
      workAssignmentId: waiterAssignment.rows[0].id,
      expiresAt: new Date(Date.now() + 60_000),
    };
    await sessions.createBusinessSession({
      ...input,
      refreshTokenHash: 'c'.repeat(64),
    });

    await expect(
      sessions.createBusinessSession({
        ...input,
        refreshTokenHash: 'e'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('creates and revokes an isolated Platform Super Admin session', async () => {
    const created = await sessions.createPlatformAdminSession({
      platformAdminId: adminId,
      refreshTokenHash: 'f'.repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
      devicePlatform: 'web',
    });
    await expect(
      sessions.isActive({
        sessionKind: 'PLATFORM_ADMIN',
        sessionId: created.sessionId,
        subjectId: adminId,
      }),
    ).resolves.toBe(true);
    await expect(
      sessions.revoke({
        sessionKind: 'PLATFORM_ADMIN',
        sessionId: created.sessionId,
        subjectId: adminId,
        reason: 'Integration logout',
      }),
    ).resolves.toBe(true);
  });

  it('persists business and Platform Super Admin audit identities separately', async () => {
    await audit.record({
      actor: {
        identityType: 'BUSINESS_USER',
        subjectId: userId,
        role: 'MANAGER',
        membershipId,
        membershipRoleId,
        workAssignmentId,
        businessId,
        branchId,
      },
      actionType: 'V2_INTEGRATION_USER',
      recordType: 'USER',
      recordId: userId,
    });
    await audit.record({
      actor: {
        identityType: 'PLATFORM_ADMIN',
        subjectId: adminId,
        role: 'PLATFORM_SUPER_ADMIN',
      },
      actionType: 'V2_INTEGRATION_ADMIN',
      recordType: 'PLATFORM_ADMIN',
      recordId: adminId,
    });

    const result = await pool.query<{
      action_type: string;
      user_id: string | null;
      platform_admin_id: string | null;
    }>(
      `SELECT action_type, user_id, platform_admin_id
       FROM audit_logs
       WHERE action_type IN ('V2_INTEGRATION_USER','V2_INTEGRATION_ADMIN')
       ORDER BY action_type`,
    );
    expect(result.rows).toEqual([
      {
        action_type: 'V2_INTEGRATION_ADMIN',
        user_id: null,
        platform_admin_id: adminId,
      },
      {
        action_type: 'V2_INTEGRATION_USER',
        user_id: userId,
        platform_admin_id: null,
      },
    ]);
  });

  it('consumes one initial branch credit and none for its pending recheck', async () => {
    const seededTransaction = await pool.query<{ id: string; bank_id: string }>(
      `WITH bank AS (
         INSERT INTO supported_banks (
           official_name, short_name, account_type, verification_method,
           verifyet_bank_identifier
         ) VALUES (
           'Verification Test Bank', 'VTB', 'BANK_ACCOUNT', 'REFERENCE',
           'verification-test-bank'
         ) RETURNING id
       ), account AS (
         INSERT INTO settlement_accounts (
           business_id, scope_type, branch_id, bank_id, account_name,
           account_number_encrypted, account_number_hash,
           masked_account_number, normalized_account_suffix,
           opening_balance, opening_balance_date,
           calculated_balance, status, created_by_membership_id
         ) SELECT
           $1, 'BRANCH', $2, bank.id, 'Verification Test Account',
           decode('00', 'hex'), repeat('a', 64), '****1234', '1234', 0,
           CURRENT_DATE, 0, 'ACTIVE', $3
         FROM bank RETURNING id, bank_id
       ), wallet AS (
         INSERT INTO branch_credit_wallets (
           branch_id, business_id, purchased_credits, used_credits,
           expired_credits, available_credits
         ) VALUES ($2, $1, 2, 0, 0, 2)
         RETURNING branch_id
       ), credit_lot AS (
         INSERT INTO credit_lots (
           business_id, branch_id, source_event_key, allocated_credits,
           starts_at, expires_at
         ) VALUES ($1, $2, 'integration:opening-credit-lot', 2,
                   now(), now() + interval '1 month')
         RETURNING id
       ), setting AS (
         INSERT INTO branch_verification_settings (
           branch_id, timezone, time_tolerance_minutes
         ) VALUES ($2, 'Africa/Addis_Ababa', 10)
         RETURNING branch_id, timezone
       )
       INSERT INTO customer_transactions (
         business_id, branch_id, work_assignment_id, submitted_by_user_id,
         settlement_account_id, bank_id, transaction_reference, amount,
         transaction_date, transaction_time, submission_method
       ) SELECT
         $1, $2, $4, $5, account.id, account.bank_id,
         'VERIFY-TRANSITION-001', 125.50,
         (CURRENT_TIMESTAMP AT TIME ZONE setting.timezone)::date,
         (CURRENT_TIMESTAMP AT TIME ZONE setting.timezone)::time,
         'QR_SCAN'
       FROM account, wallet, credit_lot, setting RETURNING id, bank_id`,
      [businessId, branchId, membershipId, workAssignmentId, userId],
    );
    const transactionId = seededTransaction.rows[0].id;
    verificationOutcomeTransactionId = transactionId;
    const verificationBankId = seededTransaction.rows[0].bank_id;

    const initialInput = {
      transactionId,
      businessId,
      branchId,
      attemptType: VerificationAttemptType.INITIAL,
      attemptKey: `verification:initial:${transactionId}`,
    };
    const initial = await verificationPreparation.prepare(initialInput);
    expect(initial).toMatchObject({
      decision: 'PREPARED',
      creditConsumed: true,
      attemptReplayed: false,
    });
    if (initial.decision !== 'PREPARED') {
      throw new Error('Expected the initial verification to be prepared');
    }

    await expect(
      verificationPreparation.prepare(initialInput),
    ).resolves.toMatchObject({
      decision: 'PREPARED',
      creditConsumed: false,
      attemptReplayed: true,
      attempt: { id: initial.attempt.id },
    });

    const initialRequestedAt = new Date(Date.now() - 1_000);
    const initialRespondedAt = new Date(Date.now() - 500);
    const scheduledAt = initialRespondedAt;
    await expect(
      verificationOutcomes.record({
        attemptKey: initial.attempt.attemptKey,
        result: VerificationAttemptResult.PENDING,
        providerRequestId: `provider-initial-${transactionId}`,
        providerStatus: 'PENDING',
        requestedAt: initialRequestedAt,
        respondedAt: initialRespondedAt,
        nextRecheckAt: scheduledAt,
      }),
    ).resolves.toMatchObject({
      transactionStatus: 'PENDING',
      replayed: false,
      nextRecheckNumber: 1,
    });
    await expect(
      verificationOutcomes.record({
        attemptKey: initial.attempt.attemptKey,
        result: VerificationAttemptResult.PENDING,
        providerRequestId: `provider-initial-${transactionId}`,
        providerStatus: 'PENDING',
        requestedAt: initialRequestedAt,
        respondedAt: initialRespondedAt,
      }),
    ).resolves.toMatchObject({ replayed: true });

    const claim = await pendingRechecks.claimNext('integration-worker', 60);
    expect(claim).toMatchObject({
      transactionId,
      recheckNumber: 1,
      status: 'CLAIMED',
      claimedBy: 'integration-worker',
    });
    if (!claim) throw new Error('Expected a due pending recheck claim');
    const recheck = await pendingRecheckCoordinator.prepareClaim(claim);
    expect(recheck.decision).toBe('PREPARED');
    expect(recheck.recheck.status).toBe('COMPLETED');
    expect(typeof recheck.recheck.verificationAttemptId).toBe('string');

    const recheckRequestedAt = new Date(Date.now() - 500);
    const recheckRespondedAt = new Date();
    const verifiedPostingInput = {
      attemptKey: `verification:recheck:${transactionId}:1`,
      providerRequestId: `provider-recheck-${transactionId}-1`,
      providerStatus: 'VERIFIED' as const,
      requestedAt: recheckRequestedAt,
      respondedAt: recheckRespondedAt,
      providerBankId: verificationBankId,
      transactionReference: 'VERIFY-TRANSITION-001',
      amount: '125.50',
      receiverAccountSuffix: '1234',
      providerTransactionAt: recheckRespondedAt,
    };
    const concurrentAttemptKey = `verification:concurrent:${transactionId}:2`;
    await pool.query(
      `INSERT INTO verification_attempts (
         transaction_id, business_id, attempt_key, attempt_type,
         attempt_number, result_status, credit_transaction_id
       ) VALUES ($1, $2, $3, 'RECHECK', 3, 'QUEUED', $4)`,
      [
        transactionId,
        businessId,
        concurrentAttemptKey,
        initial.attempt.creditTransactionId,
      ],
    );
    const concurrentPostingInput = {
      ...verifiedPostingInput,
      attemptKey: concurrentAttemptKey,
      providerRequestId: `provider-concurrent-${transactionId}-2`,
    };
    const postings = await Promise.all([
      verifiedPaymentPosting.post(verifiedPostingInput),
      verifiedPaymentPosting.post(concurrentPostingInput),
    ]);
    expect(postings.map((posting) => posting.decision)).toEqual([
      'VERIFIED',
      'VERIFIED',
    ]);
    expect(postings.map((posting) => posting.replayed).sort()).toEqual([
      false,
      true,
    ]);
    expect(
      postings.every((posting) => typeof posting.ledgerEntryId === 'string'),
    ).toBe(true);

    const persisted = await pool.query<{
      current_status: string;
      transition_source: string;
      reason: string;
    }>(
      `SELECT transaction.current_status, history.transition_source, history.reason
       FROM customer_transactions transaction
       JOIN transaction_status_history history
         ON history.transaction_id = transaction.id
       WHERE transaction.id = $1
       ORDER BY history.created_at`,
      [transactionId],
    );
    expect(persisted.rows).toEqual([
      {
        current_status: 'VERIFIED',
        transition_source: 'VERIFYET',
        reason: 'PROVIDER_PENDING',
      },
      {
        current_status: 'VERIFIED',
        transition_source: 'SYSTEM',
        reason: 'RECHECK_QUEUED',
      },
      {
        current_status: 'VERIFIED',
        transition_source: 'SYSTEM',
        reason: 'MATCHED_VERIFIED',
      },
    ]);

    const credits = await pool.query<{
      available_credits: string;
      used_credits: string;
      event_count: string;
      lot_used: string;
      lot_remaining: string;
      event_type: string;
    }>(
      `SELECT wallet.available_credits, wallet.used_credits,
              count(event.id)::text AS event_count,
              lot.used_credits::text AS lot_used,
              lot.remaining_credits::text AS lot_remaining,
              max(event.movement_type) AS event_type
       FROM branch_credit_wallets wallet
       JOIN credit_lots lot ON lot.branch_id = wallet.branch_id
       LEFT JOIN credit_transactions event
         ON event.branch_id = wallet.branch_id
        AND event.related_record_id = $1
        AND event.movement_type = 'VERIFICATION_DEDUCTION'
       WHERE wallet.branch_id = $2
       GROUP BY wallet.available_credits, wallet.used_credits,
                lot.used_credits, lot.remaining_credits`,
      [transactionId, branchId],
    );
    expect(credits.rows).toEqual([
      {
        available_credits: '1', used_credits: '1', event_count: '1',
        lot_used: '1', lot_remaining: '1',
        event_type: 'VERIFICATION_DEDUCTION',
      },
    ]);

    const creditLogin = await app.getHttpAdapter().getInstance().inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: {
        identity: 'v2-manager@example.test',
        password: 'V2-Manager-Integration-Password!', devicePlatform: 'web',
        context: { membershipId, membershipRoleId, workAssignmentId },
      },
    });
    const creditAuth = responseData<{ accessToken: string }>(creditLogin);
    const creditHeaders = {
      authorization: `Bearer ${creditAuth.accessToken}`,
    };
    const creditUrl =
      `/api/v1/businesses/${businessId}/branches/${branchId}/credits`;
    const walletResponse = await app.getHttpAdapter().getInstance().inject({
      method: 'GET', url: creditUrl, headers: creditHeaders,
    });
    expect(responseData<{
      wallet: { availableCredits: number; usedCredits: number };
      lots: Array<{ usedCredits: number; remainingCredits: number }>;
    }>(walletResponse)).toMatchObject({
      wallet: { availableCredits: 1, usedCredits: 1 },
      lots: [{ usedCredits: 1, remainingCredits: 1 }],
    });
    const historyResponse = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: `${creditUrl}/history?eventType=VERIFICATION_DEDUCTION`,
      headers: creditHeaders,
    });
    expect(responseData<Array<{
      eventType: string;
      creditDelta: number;
      balanceBefore: number;
      balanceAfter: number;
    }>>(historyResponse)).toMatchObject([{
      eventType: 'VERIFICATION_DEDUCTION', creditDelta: -1,
      balanceBefore: 2, balanceAfter: 1,
    }]);

    const subscription = await pool.query<{ id: string }>(
      `WITH plan AS (
         SELECT id, name, credits, price_etb, duration_days
         FROM subscription_plans WHERE name = 'Starter'
       ), platform_account AS (
         INSERT INTO platform_settlement_accounts (
           bank_id, account_name, account_number_encrypted,
           account_number_hash, masked_account_number,
           opening_balance, calculated_balance
         ) VALUES ($1, 'Phase 7 Platform Account', decode('01','hex'),
                   repeat('b',64), '****9001', 0, 0)
         RETURNING id
       ), purchase AS (
         INSERT INTO subscription_orders (
           business_id, branch_id, plan_id, plan_name_snapshot,
           credits_snapshot, price_snapshot, duration_days_snapshot,
           purchasing_membership_id, payment_bank_id, platform_account_id,
           status
         ) SELECT $2,$3,plan.id,plan.name,plan.credits,plan.price_etb,
                  plan.duration_days,$4,$1,platform_account.id,'VERIFIED'
         FROM plan, platform_account RETURNING id, plan_id
       )
       INSERT INTO business_subscriptions (
         business_id, branch_id, order_id, plan_id, credits_allocated,
         price_paid, start_at, expiry_at, status
       ) SELECT $2,$3,purchase.id,purchase.plan_id,10000,8000.00,
                now(),now() + interval '30 days','ACTIVE'
       FROM purchase RETURNING id`,
      [verificationBankId, businessId, branchId, membershipId],
    );
    const grantInput = {
      id: '45454545-4545-4454-8454-454545454545',
      eventKey: `subscription-grant:${subscription.rows[0].id}`,
      businessId, branchId, subscriptionId: subscription.rows[0].id,
    };
    await expect(creditLifecycle.grantSubscription(grantInput))
      .resolves.toMatchObject({
        creditLotId: grantInput.id, creditsGranted: 10_000,
        balanceBefore: 1, balanceAfter: 10_001, replayed: false,
      });
    await expect(creditLifecycle.grantSubscription(grantInput))
      .resolves.toMatchObject({
        creditLotId: grantInput.id, balanceAfter: 10_001, replayed: true,
      });
    await pool.query(
      `UPDATE credit_lots
       SET starts_at = now() - interval '2 days',
           expires_at = now() - interval '1 day'
       WHERE id = $1`,
      [grantInput.id],
    );
    await expect(creditLifecycle.expireDue(new Date(), 10))
      .resolves.toMatchObject([{
        creditLotId: grantInput.id, creditsExpired: 10_000,
        balanceBefore: 10_001, balanceAfter: 1,
      }]);
    await expect(creditLifecycle.expireDue(new Date(), 10))
      .resolves.toEqual([]);
    const lifecycle = await pool.query<{
      purchased_credits: string;
      used_credits: string;
      expired_credits: string;
      available_credits: string;
      grant_events: string;
      expiry_events: string;
      threshold_alerts: string;
    }>(
      `SELECT wallet.purchased_credits::text, wallet.used_credits::text,
              wallet.expired_credits::text, wallet.available_credits::text,
         (SELECT count(*)::text FROM credit_transactions
          WHERE credit_event_key = $2
            AND movement_type = 'SUBSCRIPTION_CREDIT_GRANT') AS grant_events,
         (SELECT count(*)::text FROM credit_transactions
          WHERE credit_event_key = $3
            AND movement_type = 'CREDIT_EXPIRY') AS expiry_events,
         (SELECT count(*)::text FROM credit_usage_alerts
          WHERE credit_lot_id = $1) AS threshold_alerts
       FROM branch_credit_wallets wallet WHERE wallet.branch_id = $4`,
      [grantInput.id, grantInput.eventKey, `expiry:lot:${grantInput.id}`, branchId],
    );
    expect(lifecycle.rows[0]).toEqual({
      purchased_credits: '10002', used_credits: '1',
      expired_credits: '10000', available_credits: '1',
      grant_events: '1', expiry_events: '1', threshold_alerts: '3',
    });
    const alertedWallet = await app.getHttpAdapter().getInstance().inject({
      method: 'GET', url: creditUrl, headers: creditHeaders,
    });
    expect(responseData<{
      alerts: Array<{ thresholdPercent: number; creditLotId: string }>;
    }>(alertedWallet).alerts
      .filter((alert) => alert.creditLotId === grantInput.id)
      .map((alert) => alert.thresholdPercent).sort((left, right) => left - right))
      .toEqual([75, 90, 100]);

    const attempts = await pool.query<{
      id: string;
      attempt_type: string;
      attempt_number: number;
      result_status: string;
      credit_transaction_id: string;
    }>(
      `SELECT id, attempt_type, attempt_number, result_status,
              credit_transaction_id
       FROM verification_attempts
       WHERE transaction_id = $1
       ORDER BY attempt_number`,
      [transactionId],
    );
    expect(
      attempts.rows.map((attempt) => ({
        attempt_type: attempt.attempt_type,
        attempt_number: attempt.attempt_number,
        result_status: attempt.result_status,
        credit_transaction_id: attempt.credit_transaction_id,
      })),
    ).toEqual([
      {
        attempt_type: 'INITIAL',
        attempt_number: 1,
        result_status: 'PENDING',
        credit_transaction_id: initial.attempt.creditTransactionId,
      },
      {
        attempt_type: 'RECHECK',
        attempt_number: 2,
        result_status: 'VERIFIED',
        credit_transaction_id: initial.attempt.creditTransactionId,
      },
      {
        attempt_type: 'RECHECK',
        attempt_number: 3,
        result_status: 'VERIFIED',
        credit_transaction_id: initial.attempt.creditTransactionId,
      },
    ]);
    expect(attempts.rows.every((attempt) => attempt.id.length > 0)).toBe(true);

    const recheckJobs = await pool.query<{
      status: string;
      verification_attempt_id: string | null;
      claim_token: string | null;
      completed_at: Date | null;
    }>(
      `SELECT status, verification_attempt_id, claim_token, completed_at
       FROM pending_rechecks
       WHERE transaction_id = $1
       ORDER BY recheck_number`,
      [transactionId],
    );
    expect(recheckJobs.rows).toHaveLength(1);
    expect(recheckJobs.rows[0]).toMatchObject({
      status: 'COMPLETED',
      verification_attempt_id: attempts.rows[1].id,
      claim_token: null,
    });
    expect(recheckJobs.rows[0].completed_at).toBeInstanceOf(Date);

    const financialPosting = await pool.query<{
      calculated_balance: string;
      confirmation_count: string;
      ledger_count: string;
      centralized_count: string;
    }>(
      `SELECT account.calculated_balance::text,
              count(DISTINCT confirmation.id)::text AS confirmation_count,
              count(DISTINCT ledger.id)::text AS ledger_count,
              count(DISTINCT ledger.id) FILTER (
                WHERE ledger.audit_log_id IS NOT NULL
                  AND ledger.idempotency_key LIKE 'ledger:verified:%'
              )::text AS centralized_count
       FROM settlement_accounts account
       LEFT JOIN transaction_confirmations confirmation
         ON confirmation.settlement_account_id = account.id
        AND confirmation.transaction_id = $1
       LEFT JOIN ledger_entries ledger
         ON ledger.source_record_type = 'TRANSACTION_CONFIRMATION'
        AND ledger.source_record_id = confirmation.id
       WHERE account.id = (
         SELECT settlement_account_id FROM customer_transactions WHERE id = $1
       )
       GROUP BY account.calculated_balance`,
      [transactionId],
    );
    expect(financialPosting.rows).toEqual([
      {
        calculated_balance: '125.50',
        confirmation_count: '1',
        ledger_count: '1',
        centralized_count: '1',
      },
    ]);
  });

  it('settles one deferred subscription credit for every plan at zero balance', async () => {
    const platform = await pool.query<{ id: string; bank_id: string }>(
      `SELECT id, bank_id FROM platform_settlement_accounts
       WHERE status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1`,
    );
    const plans = [
      { name: 'Starter', credits: 10_000, suffix: '1' },
      { name: 'Professional', credits: 20_000, suffix: '2' },
      { name: 'Business', credits: 30_000, suffix: '3' },
    ];
    const deferredIds: string[] = [];
    for (const [index, plan] of plans.entries()) {
      const seeded = await pool.query<{ branch_id: string; order_id: string }>(
        `WITH branch AS (
           INSERT INTO branches (
             branch_code, business_id, branch_name, address, city, sub_city,
             woreda, location_details, status, created_by_membership_id,
             activated_at
           ) VALUES ($1,$2,$3,'Credit test address','Addis Ababa','Bole','03',
                     'Deferred credit integration branch','ACTIVE',$4,now())
           RETURNING id
         ), plan AS (
           SELECT id, name, credits, price_etb, duration_days
           FROM subscription_plans WHERE name = $5
         ), purchase AS (
           INSERT INTO subscription_orders (
             business_id, branch_id, plan_id, plan_name_snapshot,
             credits_snapshot, price_snapshot, duration_days_snapshot,
             purchasing_membership_id, payment_bank_id, platform_account_id,
             status
           ) SELECT $2,branch.id,plan.id,plan.name,plan.credits,plan.price_etb,
                    plan.duration_days,$4,$6,$7,'ORDER_CREATED'
           FROM branch, plan RETURNING id, branch_id
         )
         SELECT purchase.branch_id, purchase.id AS order_id FROM purchase`,
        [
          `V2-CREDIT-${plan.suffix}`, businessId,
          `${plan.name} Credit Branch`, membershipId, plan.name,
          platform.rows[0].bank_id, platform.rows[0].id,
        ],
      );
      const scope = seeded.rows[0];
      const number = String(index + 1);
      const deferredId = `61000000-0000-4000-8000-00000000000${number}`;
      const deferral = {
        id: deferredId,
        eventKey: `subscription-deferral:${scope.order_id}`,
        businessId, branchId: scope.branch_id,
        subscriptionOrderId: scope.order_id,
      };
      deferredIds.push(deferredId);
      await expect(creditLifecycle.deferSubscriptionVerification(deferral))
        .resolves.toMatchObject({ balance: 0, replayed: false });
      await expect(creditLifecycle.deferSubscriptionVerification(deferral))
        .resolves.toMatchObject({ balance: 0, replayed: true });
      await pool.query(
        `UPDATE subscription_orders SET status = 'VERIFIED' WHERE id = $1`,
        [scope.order_id],
      );
      const subscription = await pool.query<{ id: string }>(
        `INSERT INTO business_subscriptions (
           business_id, branch_id, order_id, plan_id, credits_allocated,
           price_paid, start_at, expiry_at, status
         ) SELECT purchase.business_id, purchase.branch_id, purchase.id,
                  purchase.plan_id, purchase.credits_snapshot,
                  purchase.price_snapshot, now(),
                  now() + make_interval(days => purchase.duration_days_snapshot),
                  'ACTIVE'
           FROM subscription_orders purchase WHERE purchase.id = $1
         RETURNING id`,
        [scope.order_id],
      );
      const grant = {
        id: `62000000-0000-4000-8000-00000000000${number}`,
        eventKey: `subscription-grant:${subscription.rows[0].id}`,
        businessId, branchId: scope.branch_id,
        subscriptionId: subscription.rows[0].id,
      };
      await expect(creditLifecycle.grantSubscription(grant))
        .resolves.toMatchObject({
          creditsGranted: plan.credits,
          balanceBefore: 0,
          balanceAfter: plan.credits - 1,
          deferredDeductionId: deferredId,
          deferredSettled: true,
          replayed: false,
        });
      await expect(creditLifecycle.grantSubscription(grant))
        .resolves.toMatchObject({
          balanceAfter: plan.credits - 1,
          deferredDeductionId: deferredId,
          deferredSettled: true,
          replayed: true,
        });
      const persisted = await pool.query<{
        available_credits: string;
        used_credits: string;
        pending_count: string;
        settled_count: string;
        deferred_events: string;
        settlement_events: string;
      }>(
        `SELECT wallet.available_credits::text, wallet.used_credits::text,
           (SELECT count(*)::text FROM deferred_credit_deductions
            WHERE subscription_order_id = $2 AND status = 'PENDING') pending_count,
           (SELECT count(*)::text FROM deferred_credit_deductions
            WHERE subscription_order_id = $2 AND status = 'SETTLED') settled_count,
           (SELECT count(*)::text FROM credit_transactions
            WHERE related_record_id = $2
              AND movement_type = 'SUBSCRIPTION_VERIFICATION_DEFERRED')
             deferred_events,
           (SELECT count(*)::text FROM credit_transactions
            WHERE related_record_id = $3
              AND movement_type = 'DEFERRED_DEDUCTION_SETTLED') settlement_events
         FROM branch_credit_wallets wallet WHERE wallet.branch_id = $1`,
        [scope.branch_id, scope.order_id, deferredId],
      );
      expect(persisted.rows[0]).toEqual({
        available_credits: String(plan.credits - 1), used_credits: '1',
        pending_count: '0', settled_count: '1',
        deferred_events: '1', settlement_events: '1',
      });
    }
    await expect(pool.query(
      `DELETE FROM deferred_credit_deductions WHERE id = $1`,
      [deferredIds[0]],
    )).rejects.toThrow(/immutable/iu);
  });

  it('posts an idempotent ledger sequence and a compensating reversal', async () => {
    const scope = await pool.query<{
      settlement_account_id: string; calculated_balance: string;
    }>(
      `SELECT transaction.settlement_account_id,
              account.calculated_balance::text
       FROM customer_transactions transaction
       JOIN settlement_accounts account
         ON account.id = transaction.settlement_account_id
       WHERE transaction.id = $1`,
      [verificationOutcomeTransactionId],
    );
    const audit = await pool.query<{ id: string }>(
      `INSERT INTO audit_logs (
         user_id, membership_id, role_code, business_id, branch_id,
         action_type, record_type, reason, result
       ) VALUES
         ($1,$2,'PRIMARY_OWNER',$3,$4,'LEDGER_TEST_DEPOSIT','LEDGER_ENTRY','Integration deposit','SUCCESS'),
         ($1,$2,'PRIMARY_OWNER',$3,$4,'LEDGER_TEST_WITHDRAWAL','LEDGER_ENTRY','Integration withdrawal','SUCCESS'),
         ($1,$2,'PRIMARY_OWNER',$3,$4,'LEDGER_TEST_REVERSAL','LEDGER_ENTRY','Integration reversal','SUCCESS')
       RETURNING id`,
      [userId, membershipId, businessId, branchId],
    );
    const depositInput = {
      businessId, branchId,
      settlementAccountId: scope.rows[0].settlement_account_id,
      entryType: LedgerEntryType.MANUAL_DEPOSIT,
      amount: '40.00', actualTransactionAt: new Date(),
      sourceRecordType: 'MANUAL_DEPOSIT', sourceRecordId: audit.rows[0].id,
      description: 'Integration manual deposit', createdByUserId: userId,
      workAssignmentId, auditLogId: audit.rows[0].id,
      idempotencyKey: `ledger:integration:deposit:${audit.rows[0].id}`,
    } as const;
    const deposits = await Promise.all([
      ledgerPostings.post(depositInput), ledgerPostings.post(depositInput),
    ]);
    expect(deposits.map((result) => result.replayed).sort()).toEqual([
      false, true,
    ]);
    expect(deposits[0].entry.id).toBe(deposits[1].entry.id);

    const withdrawal = await ledgerPostings.post({
      ...depositInput, entryType: LedgerEntryType.WITHDRAWAL, amount: '10.00',
      sourceRecordType: 'WITHDRAWAL', sourceRecordId: audit.rows[1].id,
      description: 'Integration withdrawal', auditLogId: audit.rows[1].id,
      idempotencyKey: `ledger:integration:withdrawal:${audit.rows[1].id}`,
    });
    const reversalInput = {
      businessId, branchId, originalEntryId: withdrawal.entry.id,
      actualTransactionAt: new Date(), sourceRecordType: 'BALANCE_REVERSAL',
      sourceRecordId: audit.rows[2].id, description: 'Approved test reversal',
      createdByUserId: userId, workAssignmentId,
      auditLogId: audit.rows[2].id,
      idempotencyKey: `ledger:integration:reversal:${audit.rows[2].id}`,
    } as const;
    const reversal = await ledgerPostings.reverse(reversalInput);
    await expect(ledgerPostings.reverse(reversalInput)).resolves.toMatchObject({
      replayed: true, entry: { id: reversal.entry.id },
    });
    expect(reversal.entry).toMatchObject({
      entryType: 'REVERSAL', direction: 'CREDIT', amount: '10.00',
      reversalOfEntryId: withdrawal.entry.id,
    });

    const result = await pool.query<{
      calculated_balance: string; posted_count: string; audited_count: string;
    }>(
      `SELECT account.calculated_balance::text,
              count(entry.id)::text AS posted_count,
              count(entry.audit_log_id)::text AS audited_count
       FROM settlement_accounts account
       LEFT JOIN ledger_entries entry
         ON entry.settlement_account_id = account.id
        AND entry.idempotency_key LIKE 'ledger:integration:%'
       WHERE account.id = $1
       GROUP BY account.calculated_balance`,
      [scope.rows[0].settlement_account_id],
    );
    expect(result.rows[0]).toEqual({
      calculated_balance: (
        Number(scope.rows[0].calculated_balance) + 40
      ).toFixed(2),
      posted_count: '3', audited_count: '3',
    });

    const server = app.getHttpAdapter().getInstance();
    const login = await server.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: {
        identity: 'v2-manager@example.test',
        password: 'V2-Manager-Integration-Password!', devicePlatform: 'web',
        context: { membershipId, membershipRoleId, workAssignmentId },
      },
    });
    const auth = responseData<{ accessToken: string }>(login);
    const headers = { authorization: `Bearer ${auth.accessToken}` };
    const accountId = scope.rows[0].settlement_account_id;
    const listResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/businesses/${businessId}/ledger?settlementAccountId=${accountId}`,
      headers,
    });
    expect(listResponse.statusCode).toBe(200);
    const entries = responseData<Array<{ id: string; entryType: string }>>(
      listResponse,
    );
    expect(entries).toContainEqual(expect.objectContaining({
      id: deposits[0].entry.id, entryType: 'MANUAL_DEPOSIT',
    }));
    const serializedEntries = JSON.stringify(entries);
    for (const hidden of [
      'idempotencyKey', 'auditLogId', 'sourceRecordId',
    ]) expect(serializedEntries).not.toContain(hidden);

    const detailResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/businesses/${businessId}/ledger/${reversal.entry.id}`,
      headers,
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(responseData<{ reversalOfEntryId: string }>(detailResponse))
      .toMatchObject({ reversalOfEntryId: withdrawal.entry.id });

    const projectedResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/businesses/${businessId}/ledger/accounts/${accountId}/projected-balance?direction=DEBIT&amount=5.00`,
      headers,
    });
    expect(projectedResponse.statusCode).toBe(200);
    const projected = responseData<{
      currentBalance: string; projectedBalance: string;
    }>(projectedResponse);
    expect(projected).toEqual(expect.objectContaining({
      currentBalance: result.rows[0].calculated_balance,
      projectedBalance: (
        Number(result.rows[0].calculated_balance) - 5
      ).toFixed(2),
    }));
    await expect(pool.query(
      `UPDATE ledger_entries SET description = 'mutated' WHERE id = $1`,
      [deposits[0].entry.id],
    )).rejects.toThrow();
  });

  it('completes the V2 admin HTTP login, refresh, logout and revocation flow', async () => {
    const server = app.getHttpAdapter().getInstance();
    const login = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        identity: 'v2-admin@example.test',
        password: 'V2-Admin-Integration-Password!',
        devicePlatform: 'web',
      },
    });
    expect(login.statusCode).toBe(201);
    const loggedIn = responseData<{
      status: 'AUTHENTICATED';
      accessToken: string;
      refreshToken: string;
      principal: { role: string; identityType: string };
    }>(login);
    expect(loggedIn).toMatchObject({
      status: 'AUTHENTICATED',
      principal: {
        role: 'PLATFORM_SUPER_ADMIN',
        identityType: 'PLATFORM_ADMIN',
      },
    });

    const me = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${loggedIn.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(responseData<{ userId: string; role: string }>(me)).toMatchObject({
      userId: adminId,
      role: 'PLATFORM_SUPER_ADMIN',
    });

    const seededIncident = await pool.query<{ id: string }>(
      `INSERT INTO security_alerts (
         alert_key, alert_type, severity, details_json
       ) VALUES (
         'verifyet:provider:AUTHENTICATION_FAILED:integration-request',
         'VERIFYET_PROVIDER_FAILURE', 'CRITICAL',
         jsonb_build_object(
           'errorCode', 'AUTHENTICATION_FAILED',
           'providerRequestRecordId', 'integration-request',
           'transactionId', 'integration-transaction'
         )
       ) RETURNING id`,
    );
    const incidentId = seededIncident.rows[0].id;
    const incidents = await server.inject({
      method: 'GET',
      url: '/api/v1/platform/provider-incidents?status=OPEN&limit=10',
      headers: { authorization: `Bearer ${loggedIn.accessToken}` },
    });
    expect(incidents.statusCode).toBe(200);
    expect(
      responseData<Array<{ id: string; errorCode: string }>>(incidents),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: incidentId,
          errorCode: 'AUTHENTICATION_FAILED',
        }),
      ]),
    );

    const acknowledged = await server.inject({
      method: 'POST',
      url: `/api/v1/platform/provider-incidents/${incidentId}/acknowledge`,
      headers: { authorization: `Bearer ${loggedIn.accessToken}` },
      payload: { note: 'Integration incident acknowledged' },
    });
    expect(acknowledged.statusCode).toBe(201);
    expect(
      responseData<{
        id: string;
        status: string;
        acknowledgedByPlatformAdminId: string;
      }>(acknowledged),
    ).toMatchObject({
      id: incidentId,
      status: 'ACKNOWLEDGED',
      acknowledgedByPlatformAdminId: adminId,
    });
    const incidentAudit = await pool.query<{
      acknowledged_by_platform_admin_id: string;
      action_type: string;
      platform_admin_id: string;
    }>(
      `SELECT alert.acknowledged_by_platform_admin_id,
              audit.action_type, audit.platform_admin_id
       FROM security_alerts alert
       JOIN audit_logs audit ON audit.record_id = alert.id
       WHERE alert.id = $1
         AND audit.action_type = 'VERIFYET_INCIDENT_ACKNOWLEDGED'`,
      [incidentId],
    );
    expect(incidentAudit.rows).toEqual([
      {
        acknowledged_by_platform_admin_id: adminId,
        action_type: 'VERIFYET_INCIDENT_ACKNOWLEDGED',
        platform_admin_id: adminId,
      },
    ]);

    const refresh = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: loggedIn.refreshToken },
    });
    expect(refresh.statusCode).toBe(201);
    const refreshed = responseData<{
      accessToken: string;
      refreshToken: string;
    }>(refresh);
    expect(refreshed.refreshToken).not.toBe(loggedIn.refreshToken);

    const logout = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      payload: { refreshToken: refreshed.refreshToken },
    });
    expect(logout.statusCode).toBe(201);
    expect(responseData<{ loggedOut: boolean }>(logout)).toEqual({
      loggedOut: true,
    });

    const afterLogout = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${refreshed.accessToken}` },
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it('registers, activates and isolates a V2 Primary Owner business over HTTP', async () => {
    const server = app.getHttpAdapter().getInstance();
    const category = await pool.query<{ id: string }>(
      `SELECT id FROM business_categories WHERE name = 'Coffee House'`,
    );
    const registration = await server.inject({
      method: 'POST',
      url: '/api/v1/businesses/register',
      payload: {
        name: 'HTTP Registered Business',
        businessCode: 'V2-HTTP-REG-001',
        categoryId: category.rows[0].id,
        tin: 'TIN-V2-HTTP-001',
        businessPhone: '+251911000010',
        address: 'HTTP test address',
        city: 'Addis Ababa',
        ownerFullName: 'HTTP Primary Owner',
        ownerEmail: 'http-owner@example.test',
        ownerPhone: '+251911000011',
        password: 'V2-Owner-Integration-Password!',
      },
    });
    expect(registration.statusCode).toBe(201);
    const registered = responseData<{ id: string; status: string }>(
      registration,
    );
    expect(registered.status).toBe('REGISTRATION');

    const adminLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        identity: 'v2-admin@example.test',
        password: 'V2-Admin-Integration-Password!',
        devicePlatform: 'web',
      },
    });
    const admin = responseData<{ accessToken: string }>(adminLogin);
    const activation = await server.inject({
      method: 'PATCH',
      url: `/api/v1/businesses/${registered.id}/status`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { status: 'ACTIVE', reason: 'Integration approval' },
    });
    expect(activation.statusCode).toBe(200);
    expect(responseData<{ status: string }>(activation).status).toBe('ACTIVE');

    const ownerLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        identity: 'http-owner@example.test',
        password: 'V2-Owner-Integration-Password!',
        devicePlatform: 'web',
      },
    });
    expect(ownerLogin.statusCode).toBe(201);
    const owner = responseData<{
      accessToken: string;
      principal: {
        userId: string;
        identityType: string;
        role: string;
        businessIds: string[];
        membershipId: string;
        membershipRoleId: string;
      };
    }>(ownerLogin);
    expect(owner.principal).toMatchObject({
      identityType: 'BUSINESS_USER',
      role: 'PRIMARY_OWNER',
      businessIds: [registered.id],
    });
    expect(owner.principal.userId).toEqual(expect.any(String));
    expect(owner.principal.membershipId).toEqual(expect.any(String));
    expect(owner.principal.membershipRoleId).toEqual(expect.any(String));

    const businesses = await server.inject({
      method: 'GET',
      url: '/api/v1/businesses',
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(businesses.statusCode).toBe(200);
    expect(responseData<Array<{ id: string }>>(businesses)).toEqual([
      expect.objectContaining({ id: registered.id }),
    ]);

    const branchCreation = await server.inject({
      method: 'POST',
      url: `/api/v1/businesses/${registered.id}/branches`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: {
        name: 'HTTP Owner Branch',
        code: 'V2-HTTP-BRANCH-001',
        address: 'Branch test address',
        city: 'Addis Ababa',
        subCity: 'Bole',
        woreda: '03',
        locationDetails: 'Near the integration test landmark',
        settlementMode: 'MAIN_BUSINESS_ALL',
      },
    });
    expect(branchCreation.statusCode).toBe(201);
    const branch = responseData<{
      id: string;
      businessId: string;
      status: string;
    }>(branchCreation);
    expect(branch).toMatchObject({
      businessId: registered.id,
      status: 'SETUP_REQUIRED',
    });

    const branchUpdate = await server.inject({
      method: 'PATCH',
      url: `/api/v1/businesses/${registered.id}/branches/${branch.id}`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: {
        name: 'HTTP Owner Branch Updated',
        locationDetails: 'Updated integration test landmark',
      },
    });
    expect(branchUpdate.statusCode).toBe(200);
    expect(responseData<{ name: string }>(branchUpdate).name).toBe(
      'HTTP Owner Branch Updated',
    );

    const ownerBranches = await server.inject({
      method: 'GET',
      url: `/api/v1/businesses/${registered.id}/branches`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(ownerBranches.statusCode).toBe(200);
    expect(responseData<Array<{ id: string }>>(ownerBranches)).toEqual([
      expect.objectContaining({ id: branch.id }),
    ]);

    const staffCreation = await server.inject({
      method: 'POST',
      url: `/api/v1/businesses/${registered.id}/branches/${branch.id}/users`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: {
        fullName: 'HTTP Branch Cashier',
        email: 'http-cashier@example.test',
        phone: '+251911000012',
        temporaryPassword: 'V2-Cashier-Integration-Password!',
        role: 'CASHIER',
      },
    });
    expect(staffCreation.statusCode).toBe(201);
    const staff = responseData<{
      id: string;
      role: string;
      branchId: string;
      workAssignmentId: string;
    }>(staffCreation);
    expect(staff).toMatchObject({
      role: 'CASHIER',
      branchId: branch.id,
    });

    const staffListing = await server.inject({
      method: 'GET',
      url: `/api/v1/businesses/${registered.id}/branches/${branch.id}/users`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(staffListing.statusCode).toBe(200);
    expect(responseData<Array<{ id: string }>>(staffListing)).toEqual([
      expect.objectContaining({ id: staff.id }),
    ]);

    const staffLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        identity: 'http-cashier@example.test',
        password: 'V2-Cashier-Integration-Password!',
        devicePlatform: 'web',
      },
    });
    expect(staffLogin.statusCode).toBe(201);
    const staffSession = responseData<{ accessToken: string }>(staffLogin);

    const staffRemoval = await server.inject({
      method: 'POST',
      url: `/api/v1/businesses/${registered.id}/branches/${branch.id}/users/${staff.id}/remove`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: { reason: 'Integration staff removal' },
    });
    expect(staffRemoval.statusCode).toBe(201);
    expect(responseData<{ status: string }>(staffRemoval).status).toBe(
      'REMOVED',
    );

    const removedSession = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${staffSession.accessToken}` },
    });
    expect(removedSession.statusCode).toBe(401);

    const removedListing = await server.inject({
      method: 'GET',
      url: `/api/v1/businesses/${registered.id}/branches/${branch.id}/users?includeRemoved=true`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(removedListing.statusCode).toBe(200);
    expect(
      responseData<Array<{ id: string; assignmentStatus: string }>>(
        removedListing,
      ),
    ).toEqual([
      expect.objectContaining({ id: staff.id, assignmentStatus: 'REMOVED' }),
    ]);

    const banksResponse = await server.inject({
      method: 'GET',
      url: '/api/v1/banks',
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(banksResponse.statusCode).toBe(200);
    const banks =
      responseData<Array<{ id: string; shortName: string }>>(banksResponse);
    const cbe = banks.find((bank) => bank.shortName === 'CBE');
    expect(cbe).toBeDefined();

    const rawBusinessAccount = '1000200030004567';
    const businessAccountCreation = await server.inject({
      method: 'POST',
      url: `/api/v1/businesses/${registered.id}/branches/${branch.id}/settlement-accounts`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: {
        bankId: cbe!.id,
        accountName: 'HTTP Branch Settlement Account',
        accountValue: rawBusinessAccount,
        openingBalance: 1250.5,
        openingBalanceDate: '2026-08-05',
      },
    });
    expect(businessAccountCreation.statusCode).toBe(201);
    const businessAccount = responseData<{
      id: string;
      accountMask: string;
      status: string;
    }>(businessAccountCreation);
    expect(businessAccount).toMatchObject({
      accountMask: '************4567',
      status: 'ACTIVE',
    });

    const storedAccount = await pool.query<{
      envelope: string;
      account_number_hash: string;
      masked_account_number: string;
    }>(
      `SELECT convert_from(account_number_encrypted, 'UTF8') AS envelope,
              account_number_hash, masked_account_number
       FROM settlement_accounts WHERE id = $1`,
      [businessAccount.id],
    );
    expect(storedAccount.rows[0].envelope).not.toContain(rawBusinessAccount);
    expect(storedAccount.rows[0].account_number_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(storedAccount.rows[0].masked_account_number).toBe(
      '************4567',
    );

    const branchAccounts = await server.inject({
      method: 'GET',
      url: `/api/v1/businesses/${registered.id}/branches/${branch.id}/settlement-accounts`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(branchAccounts.statusCode).toBe(200);
    expect(responseData<Array<{ id: string }>>(branchAccounts)).toEqual([
      expect.objectContaining({ id: businessAccount.id }),
    ]);

    const globalDuplicate = await server.inject({
      method: 'POST',
      url: '/api/v1/platform/subscription-settlement-accounts',
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: {
        bankId: cbe!.id,
        accountName: 'Duplicate Platform Account',
        accountValue: rawBusinessAccount,
        openingBalance: 0,
      },
    });
    expect(globalDuplicate.statusCode).toBe(409);

    const platformAccountCreation = await server.inject({
      method: 'POST',
      url: '/api/v1/platform/subscription-settlement-accounts',
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: {
        bankId: cbe!.id,
        accountName: 'HTTP Platform Settlement Account',
        accountValue: '9000800070006543',
        openingBalance: 500,
      },
    });
    expect(platformAccountCreation.statusCode).toBe(201);
    const platformAccount = responseData<{ id: string; status: string }>(
      platformAccountCreation,
    );
    expect(platformAccount.status).toBe('ACTIVE');

    const platformAccountUpdate = await server.inject({
      method: 'PATCH',
      url: `/api/v1/platform/subscription-settlement-accounts/${platformAccount.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { active: false },
    });
    expect(platformAccountUpdate.statusCode).toBe(200);
    expect(responseData<{ status: string }>(platformAccountUpdate).status).toBe(
      'INACTIVE',
    );

    const businessAccountDeactivation = await server.inject({
      method: 'POST',
      url: `/api/v1/businesses/${registered.id}/branches/${branch.id}/settlement-accounts/${businessAccount.id}/deactivate`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(businessAccountDeactivation.statusCode).toBe(201);
    expect(
      responseData<{ status: string }>(businessAccountDeactivation).status,
    ).toBe('INACTIVE');

    const otherTenantLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        identity: 'v2-manager@example.test',
        password: 'V2-Manager-Integration-Password!',
        devicePlatform: 'web',
        context: {
          membershipId,
          membershipRoleId,
          workAssignmentId,
        },
      },
    });
    expect(otherTenantLogin.statusCode).toBe(201);
    const otherTenant = responseData<{ accessToken: string }>(otherTenantLogin);
    const crossTenantBranches = await server.inject({
      method: 'GET',
      url: `/api/v1/businesses/${registered.id}/branches`,
      headers: { authorization: `Bearer ${otherTenant.accessToken}` },
    });
    expect(crossTenantBranches.statusCode).toBe(403);
  }, 30_000);

  it('enforces Waiter own-history isolation at the database boundary', async () => {
    const transaction = await pool.query<{
      id: string;
      submitted_by_user_id: string;
    }>(
      `SELECT id, submitted_by_user_id
       FROM customer_transactions
       WHERE transaction_reference = 'VERIFY-TRANSITION-001'`,
    );
    const transactionId = transaction.rows[0].id;
    const submittedByUserId = transaction.rows[0].submitted_by_user_id;
    const receipt = await pool.query<{ id: string }>(
      `INSERT INTO transaction_receipts (
         transaction_id, storage_object_key, file_name, mime_type,
         file_size_bytes, file_hash, submitted_by_user_id
       ) VALUES ($1, $2, 'receipt.png', 'image/png', 128, $3, $4)
       RETURNING id`,
      [
        transactionId,
        `private/integration/${transactionId}.png`,
        'b'.repeat(64),
        submittedByUserId,
      ],
    );
    const decision = await pool.query<{ id: string }>(
      `INSERT INTO receipt_match_decisions (
         receipt_id, transaction_id, decision, reason_code
       ) VALUES ($1, $2, 'REVIEW_REQUIRED', 'NO_QR') RETURNING id`,
      [receipt.rows[0].id, transactionId],
    );
    const reviewCase = await pool.query<{ id: string }>(
      `INSERT INTO receipt_review_cases (
         receipt_match_decision_id, transaction_id
       ) VALUES ($1, $2) RETURNING id`,
      [decision.rows[0].id, transactionId],
    );
    receiptReviewCaseId = reviewCase.rows[0].id;
    reviewedTransactionId = transactionId;
    await pool.query(
      `INSERT INTO receipt_review_case_history (
         case_id, from_status, to_status
       ) VALUES ($1, NULL, 'OPEN')`,
      [receiptReviewCaseId],
    );
    const waiter = {
      userId: submittedByUserId,
      sessionId: 'waiter-integration-session',
      role: 'WAITER' as const,
      identityType: 'BUSINESS_USER' as const,
      businessIds: [businessId],
      branchId,
    };

    const ownHistory = await transactionQueries.list(
      businessId,
      { limit: 50, offset: 0 },
      waiter,
    );
    expect(ownHistory).toContainEqual(
      expect.objectContaining({
        id: transactionId,
        submittedByUserId,
        maskedReceiverAccount: undefined,
      }),
    );
    await expect(
      transactionQueries.history(businessId, transactionId, waiter),
    ).resolves.toHaveLength(3);
    await expect(
      transactionQueries.receiptDecisions(businessId, transactionId, waiter),
    ).resolves.toEqual([
      expect.objectContaining({
        receiptId: receipt.rows[0].id,
        decision: 'REVIEW_REQUIRED',
        reasonCode: 'NO_QR',
      }),
    ]);
    await expect(
      transactionQueries.receiptReviewSummary(businessId, {}, waiter),
    ).resolves.toEqual({
      total: 1,
      matched: 0,
      reviewRequired: 1,
      reasons: { NO_QR: 1 },
    });
    await expect(
      transactionQueries.require(businessId, transactionId, {
        ...waiter,
        userId: adminId,
      }),
    ).rejects.toThrow('Transaction not found');
  });

  it('acknowledges and resolves a scoped review case without financial mutation', async () => {
    const server = app.getHttpAdapter().getInstance();
    const login = await server.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: {
        identity: 'v2-manager@example.test',
        password: 'V2-Manager-Integration-Password!', devicePlatform: 'web',
        context: { membershipId, membershipRoleId, workAssignmentId },
      },
    });
    const auth = responseData<{ accessToken: string }>(login);
    const authorization = { authorization: `Bearer ${auth.accessToken}` };
    const before = await pool.query<{
      current_status: string; ledger_entry_id: string | null;
    }>(
      `SELECT current_status, ledger_entry_id FROM customer_transactions WHERE id = $1`,
      [reviewedTransactionId],
    );
    const queue = await server.inject({
      method: 'GET',
      url: `/api/v1/businesses/${businessId}/receipt-review-queue?status=OPEN`,
      headers: authorization,
    });
    expect(queue.statusCode).toBe(200);
    expect(responseData<Array<{ id: string }>>(queue)).toContainEqual(
      expect.objectContaining({ id: receiptReviewCaseId }),
    );
    const ageing = await server.inject({
      method: 'GET',
      url: `/api/v1/businesses/${businessId}/receipt-review-queue/ageing-summary?slaHours=24`,
      headers: authorization,
    });
    expect(ageing.statusCode).toBe(200);
    expect(responseData<{
      totalActive: number; open: number; withinSla: number;
    }>(ageing)).toMatchObject({ totalActive: 1, open: 1, withinSla: 1 });
    const acknowledged = await server.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/receipt-review-queue/${receiptReviewCaseId}/acknowledge`,
      headers: authorization, payload: { note: 'Integration review started' },
    });
    expect(acknowledged.statusCode).toBe(201);
    expect(responseData<{ status: string }>(acknowledged).status).toBe('ACKNOWLEDGED');
    const resolved = await server.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/receipt-review-queue/${receiptReviewCaseId}/resolve`,
      headers: authorization,
      payload: { resolutionCode: 'INVALID_RECEIPT', note: 'Evidence rejected' },
    });
    expect(resolved.statusCode).toBe(201);
    expect(responseData<{ status: string }>(resolved).status).toBe('RESOLVED');
    const historyResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/businesses/${businessId}/receipt-review-queue/${receiptReviewCaseId}/history`,
      headers: authorization,
    });
    expect(historyResponse.statusCode).toBe(200);
    expect(responseData<Array<{ toStatus: string }>>(historyResponse).map(
      (entry) => entry.toStatus,
    )).toEqual(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']);
    const after = await pool.query<{
      current_status: string; ledger_entry_id: string | null;
    }>(
      `SELECT current_status, ledger_entry_id FROM customer_transactions WHERE id = $1`,
      [reviewedTransactionId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    const history = await pool.query<{ to_status: string }>(
      `SELECT to_status FROM receipt_review_case_history
       WHERE case_id = $1 ORDER BY created_at, id`,
      [receiptReviewCaseId],
    );
    expect(history.rows.map((row) => row.to_status)).toEqual([
      'OPEN', 'ACKNOWLEDGED', 'RESOLVED',
    ]);
  });

  it('returns correlated sanitized outcomes and gives Managers no approval operation', async () => {
    const server = app.getHttpAdapter().getInstance();
    const login = await server.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: {
        identity: 'v2-manager@example.test',
        password: 'V2-Manager-Integration-Password!', devicePlatform: 'web',
        context: { membershipId, membershipRoleId, workAssignmentId },
      },
    });
    const auth = responseData<{ accessToken: string }>(login);
    const correlationId = 'phase3-outcome-test-1234';
    const headers = {
      authorization: `Bearer ${auth.accessToken}`,
      'x-correlation-id': correlationId,
    };
    const outcomes = await server.inject({
      method: 'GET',
      url: `/api/v1/businesses/${businessId}/transactions/${verificationOutcomeTransactionId}/verification-outcomes`,
      headers,
    });
    expect(outcomes.statusCode).toBe(200);
    expect(outcomes.headers['x-correlation-id']).toBe(correlationId);
    const outcomeBody = outcomes.json<{
      correlationId: string;
      data: Array<{ outcome: string; attemptNumber: number }>;
    }>();
    expect(outcomeBody.correlationId).toBe(correlationId);
    expect(outcomeBody.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ outcome: 'PENDING', attemptNumber: 1 }),
      expect.objectContaining({ outcome: 'VERIFIED' }),
    ]));
    const serialized = JSON.stringify(outcomeBody);
    for (const forbidden of [
      'attemptKey', 'providerRequestId', 'providerStatus',
      'creditTransactionId', 'errorCode', 'provider-initial-',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    const pending = await pool.query<{ id: string }>(
      `INSERT INTO customer_transactions (
         business_id, branch_id, work_assignment_id, submitted_by_user_id,
         settlement_account_id, bank_id, transaction_reference, amount,
         transaction_date, transaction_time, submission_method, current_status
       ) SELECT business_id, branch_id, work_assignment_id, submitted_by_user_id,
                settlement_account_id, bank_id, 'MANAGER-DENIAL-001', amount,
                transaction_date, transaction_time, submission_method, 'PENDING'
         FROM customer_transactions WHERE id = $1 RETURNING id`,
      [verificationOutcomeTransactionId],
    );
    const approvalAttempt = await server.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/transactions/${pending.rows[0].id}/verification-outcomes`,
      headers,
      payload: { status: 'VERIFIED' },
    });
    expect(approvalAttempt.statusCode).toBe(404);
    expect(approvalAttempt.headers['x-correlation-id']).toBe(correlationId);
    expect(approvalAttempt.json<{ correlationId: string }>().correlationId)
      .toBe(correlationId);
    const unchanged = await pool.query<{
      current_status: string; ledger_entry_id: string | null;
    }>(
      `SELECT current_status, ledger_entry_id
       FROM customer_transactions WHERE id = $1`,
      [pending.rows[0].id],
    );
    expect(unchanged.rows[0]).toEqual({
      current_status: 'PENDING', ledger_entry_id: null,
    });

    const documentation = await server.inject({
      method: 'GET', url: '/docs-json',
    });
    const paths = documentation.json<{
      paths: Record<string, Record<string, unknown>>;
    }>().paths;
    const outcomePath =
      '/api/v1/businesses/{businessId}/transactions/{transactionId}/verification-outcomes';
    expect(Object.keys(paths[outcomePath] ?? {})).toEqual(['get']);
    expect(Object.entries(paths).some(([path, operations]) =>
      /verif.*(approve|override)|(approve|override).*verif/iu.test(path) &&
      Object.keys(operations).some((method) => method !== 'get'),
    )).toBe(false);
  });

  it('creates an idempotent branch transaction over authenticated HTTP', async () => {
    const server = app.getHttpAdapter().getInstance();
    const account = await pool.query<{
      id: string;
      bank_id: string;
    }>(
      `SELECT id, bank_id FROM settlement_accounts
       WHERE business_id = $1 AND branch_id = $2 AND status = 'ACTIVE'
       LIMIT 1`,
      [businessId, branchId],
    );
    const login = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        identity: 'v2-manager@example.test',
        password: 'V2-Manager-Integration-Password!',
        devicePlatform: 'web',
        context: { membershipId, membershipRoleId, workAssignmentId },
      },
    });
    const auth = responseData<{ accessToken: string }>(login);
    const payload = {
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      settlementAccountId: account.rows[0].id,
      bankId: account.rows[0].bank_id,
      transactionReference: 'HTTP-SUBMISSION-001',
      amount: '75.25',
      transactionDate: '2026-08-08',
      transactionTime: '12:30:00',
      submissionMethod: 'QR_SCAN',
    };
    const url = `/api/v1/businesses/${businessId}/branches/${branchId}/transactions`;
    const created = await server.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${auth.accessToken}` },
      payload,
    });
    expect(created.statusCode).toBe(201);
    const first = responseData<{
      transaction: { id: string };
      replayed: boolean;
    }>(created);
    expect(first.replayed).toBe(false);

    const replay = await server.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${auth.accessToken}` },
      payload,
    });
    expect(responseData<{ replayed: boolean }>(replay).replayed).toBe(true);

    const conflict = await server.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${auth.accessToken}` },
      payload: { ...payload, amount: '76.25' },
    });
    expect(conflict.statusCode).toBe(409);
    const history = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM transaction_status_history
       WHERE transaction_id = $1 AND reason = 'TRANSACTION_SUBMITTED'`,
      [first.transaction.id],
    );
    expect(history.rows[0].count).toBe('1');
  });

  it('posts an idempotent Cashier manual deposit atomically over HTTP', async () => {
    const passwordHash = await hash('V2-Cashier-Integration-Password!', 4);
    const cashier = await pool.query<{
      user_id: string;
      membership_id: string;
      role_id: string;
      work_id: string;
    }>(
      `WITH cashier_user AS (
         INSERT INTO users (full_name, phone_number, email, password_hash, global_status)
         VALUES ('V2 Cashier', '+251911000099', 'v2-cashier@example.test', $1, 'ACTIVE')
         RETURNING id
       ), cashier_membership AS (
         INSERT INTO business_user_memberships (
           user_id, business_id, status, joined_at, approved_at
         ) SELECT id, $2, 'ACTIVE', now(), now() FROM cashier_user
         RETURNING id, user_id
       ), cashier_role AS (
         INSERT INTO membership_role_assignments (
           membership_id, role_code, status, approved_at, assigned_at
         ) SELECT id, 'CASHIER', 'ACTIVE', now(), now() FROM cashier_membership
         RETURNING id, membership_id
       ), cashier_work AS (
         INSERT INTO user_work_assignments (
           membership_role_id, business_id, assignment_type, branch_id,
           status, is_primary_context, approved_at, assigned_at
         ) SELECT id, $2, 'BRANCH', $3, 'ACTIVE', true, now(), now()
           FROM cashier_role
         RETURNING id, membership_role_id
       )
       SELECT cashier_user.id AS user_id,
              cashier_membership.id AS membership_id,
              cashier_role.id AS role_id, cashier_work.id AS work_id
       FROM cashier_user, cashier_membership, cashier_role, cashier_work`,
      [passwordHash, businessId, branchId],
    );
    const account = await pool.query<{ id: string; balance: string }>(
      `SELECT id, calculated_balance::text AS balance
       FROM settlement_accounts
       WHERE business_id = $1 AND branch_id = $2 AND status = 'ACTIVE'
       LIMIT 1`,
      [businessId, branchId],
    );
    const context = cashier.rows[0];
    const login = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        identity: 'v2-cashier@example.test',
        password: 'V2-Cashier-Integration-Password!',
        devicePlatform: 'web',
        context: {
          membershipId: context.membership_id,
          membershipRoleId: context.role_id,
          workAssignmentId: context.work_id,
        },
      },
    });
    expect(login.statusCode).toBe(201);
    const auth = responseData<{ accessToken: string }>(login);
    const current = account.rows[0].balance;
    const projected = (Number(current) + 31.25).toFixed(2);
    const sideEffectsBefore = await pool.query<{
      provider_requests: string;
      credit_transactions: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM verifyet_provider_requests) AS provider_requests,
         (SELECT count(*)::text FROM credit_transactions) AS credit_transactions`,
    );
    const payload = {
      idempotencyKey: '99999999-9999-4999-8999-999999999999',
      settlementAccountId: account.rows[0].id,
      amount: '31.25',
      description: 'Cash received at the counter',
      actualTransactionAt: '2026-08-08T12:00:00.000Z',
      expectedCurrentBalance: current,
      expectedProjectedBalance: projected,
    };
    const url = `/api/v1/businesses/${businessId}/branches/${branchId}/manual-deposits`;
    const created = await app.getHttpAdapter().getInstance().inject({
      method: 'POST', url,
      headers: { authorization: `Bearer ${auth.accessToken}` }, payload,
    });
    expect(created.statusCode).toBe(201);
    expect(responseData<{ replayed: boolean }>(created).replayed).toBe(false);
    const replay = await app.getHttpAdapter().getInstance().inject({
      method: 'POST', url,
      headers: { authorization: `Bearer ${auth.accessToken}` }, payload,
    });
    expect(responseData<{ replayed: boolean }>(replay).replayed).toBe(true);

    const persisted = await pool.query<{ ledger_count: string; audit_count: string }>(
      `SELECT
         (SELECT count(*)::text FROM ledger_entries
          WHERE source_record_type = 'MANUAL_DEPOSIT' AND source_record_id = $1) AS ledger_count,
         (SELECT count(*)::text FROM audit_logs
          WHERE action_type = 'MANUAL_DEPOSIT_CREATED' AND record_id = $1) AS audit_count`,
      [payload.idempotencyKey],
    );
    expect(persisted.rows[0]).toEqual({ ledger_count: '1', audit_count: '1' });
    const sideEffectsAfter = await pool.query<{
      provider_requests: string;
      credit_transactions: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM verifyet_provider_requests) AS provider_requests,
         (SELECT count(*)::text FROM credit_transactions) AS credit_transactions`,
    );
    expect(sideEffectsAfter.rows[0]).toEqual(sideEffectsBefore.rows[0]);
  });

  it('posts a scoped Cashier withdrawal once and rejects an overdraft', async () => {
    const passwordHash = await hash('V2-Withdrawal-Cashier-Password!', 4);
    const cashier = await pool.query<{
      membership_id: string;
      role_id: string;
      work_id: string;
    }>(
      `WITH cashier_user AS (
         INSERT INTO users (full_name, phone_number, email, password_hash, global_status)
         VALUES ('Withdrawal Cashier', '+251911000098',
                 'withdrawal-cashier@example.test', $1, 'ACTIVE')
         RETURNING id
       ), cashier_membership AS (
         INSERT INTO business_user_memberships (
           user_id, business_id, status, joined_at, approved_at
         ) SELECT id, $2, 'ACTIVE', now(), now() FROM cashier_user
         RETURNING id
       ), cashier_role AS (
         INSERT INTO membership_role_assignments (
           membership_id, role_code, status, approved_at, assigned_at
         ) SELECT id, 'CASHIER', 'ACTIVE', now(), now() FROM cashier_membership
         RETURNING id
       ), cashier_work AS (
         INSERT INTO user_work_assignments (
           membership_role_id, business_id, assignment_type, branch_id,
           status, is_primary_context, approved_at, assigned_at
         ) SELECT id, $2, 'BRANCH', $3, 'ACTIVE', true, now(), now()
           FROM cashier_role
         RETURNING id
       )
       SELECT cashier_membership.id AS membership_id,
              cashier_role.id AS role_id, cashier_work.id AS work_id
       FROM cashier_membership, cashier_role, cashier_work`,
      [passwordHash, businessId, branchId],
    );
    const context = cashier.rows[0];
    const login = await app.getHttpAdapter().getInstance().inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: {
        identity: 'withdrawal-cashier@example.test',
        password: 'V2-Withdrawal-Cashier-Password!', devicePlatform: 'web',
        context: {
          membershipId: context.membership_id,
          membershipRoleId: context.role_id,
          workAssignmentId: context.work_id,
        },
      },
    });
    const auth = responseData<{ accessToken: string }>(login);
    const account = await pool.query<{ id: string; balance: string }>(
      `SELECT id, calculated_balance::text AS balance
       FROM settlement_accounts
       WHERE business_id = $1 AND branch_id = $2 AND status = 'ACTIVE'
       LIMIT 1`,
      [businessId, branchId],
    );
    const current = account.rows[0].balance;
    const projected = (Number(current) - 12.5).toFixed(2);
    const payload = {
      idempotencyKey: '88888888-8888-4888-8888-888888888888',
      settlementAccountId: account.rows[0].id,
      amount: '12.50', recipientName: 'Abebe Bekele',
      recipientBankName: 'Commercial Bank of Ethiopia',
      description: 'Approved operational cash withdrawal',
      actualTransactionAt: '2026-08-08T13:00:00.000Z',
      expectedCurrentBalance: current,
      expectedProjectedBalance: projected,
    };
    const url = `/api/v1/businesses/${businessId}/branches/${branchId}/withdrawals`;
    const created = await app.getHttpAdapter().getInstance().inject({
      method: 'POST', url,
      headers: { authorization: `Bearer ${auth.accessToken}` }, payload,
    });
    expect(created.statusCode).toBe(201);
    const first = responseData<{
      replayed: boolean;
      withdrawal: { id: string; runningBalance: string };
    }>(created);
    expect(first).toMatchObject({
      replayed: false,
      withdrawal: { id: payload.idempotencyKey, runningBalance: projected },
    });
    const replay = await app.getHttpAdapter().getInstance().inject({
      method: 'POST', url,
      headers: { authorization: `Bearer ${auth.accessToken}` }, payload,
    });
    expect(responseData<{ replayed: boolean }>(replay).replayed).toBe(true);
    const changed = await app.getHttpAdapter().getInstance().inject({
      method: 'POST', url,
      headers: { authorization: `Bearer ${auth.accessToken}` },
      payload: { ...payload, recipientName: 'Changed Recipient' },
    });
    expect(changed.statusCode).toBe(409);

    const excessiveAmount = (Number(projected) + 1).toFixed(2);
    const overdraft = await app.getHttpAdapter().getInstance().inject({
      method: 'POST', url,
      headers: { authorization: `Bearer ${auth.accessToken}` },
      payload: {
        ...payload,
        idempotencyKey: '77777777-7777-4777-8777-777777777777',
        amount: excessiveAmount,
        expectedCurrentBalance: projected,
        expectedProjectedBalance: '-1.00',
      },
    });
    expect(overdraft.statusCode).toBe(409);

    const list = await app.getHttpAdapter().getInstance().inject({
      method: 'GET', url,
      headers: { authorization: `Bearer ${auth.accessToken}` },
    });
    expect(responseData<Array<{ id: string }>>(list)).toContainEqual(
      expect.objectContaining({ id: payload.idempotencyKey }),
    );
    const detail = await app.getHttpAdapter().getInstance().inject({
      method: 'GET', url: `${url}/${payload.idempotencyKey}`,
      headers: { authorization: `Bearer ${auth.accessToken}` },
    });
    expect(responseData<{ recipientName: string }>(detail).recipientName)
      .toBe('Abebe Bekele');

    const persisted = await pool.query<{
      withdrawal_count: string;
      ledger_count: string;
      audit_count: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM withdrawals WHERE id = $1) AS withdrawal_count,
         (SELECT count(*)::text FROM ledger_entries
          WHERE source_record_type = 'WITHDRAWAL' AND source_record_id = $1
            AND direction = 'DEBIT') AS ledger_count,
         (SELECT count(*)::text FROM audit_logs
          WHERE action_type = 'WITHDRAWAL_CREATED' AND record_id = $1) AS audit_count`,
      [payload.idempotencyKey],
    );
    expect(persisted.rows[0]).toEqual({
      withdrawal_count: '1', ledger_count: '1', audit_count: '1',
    });
    await expect(pool.query(
      `UPDATE withdrawals SET description = 'mutated' WHERE id = $1`,
      [payload.idempotencyKey],
    )).rejects.toThrow(/immutable/iu);
  });

  it('posts and reverses a Manager correction without mutating the original', async () => {
    const server = app.getHttpAdapter().getInstance();
    const login = await server.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: {
        identity: 'v2-manager@example.test',
        password: 'V2-Manager-Integration-Password!', devicePlatform: 'web',
        context: { membershipId, membershipRoleId, workAssignmentId },
      },
    });
    const auth = responseData<{ accessToken: string }>(login);
    const account = await pool.query<{ id: string; balance: string }>(
      `SELECT id, calculated_balance::text AS balance
       FROM settlement_accounts
       WHERE business_id = $1 AND branch_id = $2 AND status = 'ACTIVE'
       LIMIT 1`,
      [businessId, branchId],
    );
    const originalBalance = account.rows[0].balance;
    const correctedBalance = (Number(originalBalance) + 15).toFixed(2);
    const correctionPayload = {
      idempotencyKey: '66666666-6666-4666-8666-666666666666',
      settlementAccountId: account.rows[0].id,
      correctionType: 'POSITIVE', amount: '15.00',
      reason: 'Approved correction for documented reconciliation discrepancy',
      actualTransactionAt: '2026-08-08T14:00:00.000Z',
      expectedCurrentBalance: originalBalance,
      expectedProjectedBalance: correctedBalance,
    };
    const correctionsUrl =
      `/api/v1/businesses/${businessId}/branches/${branchId}/corrections`;
    const created = await server.inject({
      method: 'POST', url: correctionsUrl,
      headers: { authorization: `Bearer ${auth.accessToken}` },
      payload: correctionPayload,
    });
    expect(created.statusCode).toBe(201);
    const correction = responseData<{
      replayed: boolean;
      correction: { id: string; ledgerEntryId: string; runningBalance: string };
    }>(created);
    expect(correction).toMatchObject({
      replayed: false,
      correction: { id: correctionPayload.idempotencyKey, runningBalance: correctedBalance },
    });
    const replay = await server.inject({
      method: 'POST', url: correctionsUrl,
      headers: { authorization: `Bearer ${auth.accessToken}` },
      payload: correctionPayload,
    });
    expect(responseData<{ replayed: boolean }>(replay).replayed).toBe(true);

    const reversalPayload = {
      idempotencyKey: '55555555-5555-4555-8555-555555555555',
      reason: 'Manager approved reversal of incorrect correction entry',
      actualTransactionAt: '2026-08-08T14:05:00.000Z',
      expectedCurrentBalance: correctedBalance,
      expectedProjectedBalance: originalBalance,
    };
    const reversalUrl =
      `/api/v1/businesses/${businessId}/branches/${branchId}/ledger/` +
      `${correction.correction.ledgerEntryId}/reversal-approvals`;
    const reversed = await server.inject({
      method: 'POST', url: reversalUrl,
      headers: { authorization: `Bearer ${auth.accessToken}` },
      payload: reversalPayload,
    });
    expect(reversed.statusCode).toBe(201);
    expect(responseData<{
      replayed: boolean;
      approval: { direction: string; amount: string; runningBalance: string };
    }>(reversed)).toMatchObject({
      replayed: false,
      approval: { direction: 'DEBIT', amount: '15.00', runningBalance: originalBalance },
    });
    const reversalReplay = await server.inject({
      method: 'POST', url: reversalUrl,
      headers: { authorization: `Bearer ${auth.accessToken}` },
      payload: reversalPayload,
    });
    expect(responseData<{ replayed: boolean }>(reversalReplay).replayed).toBe(true);
    const secondApproval = await server.inject({
      method: 'POST', url: reversalUrl,
      headers: { authorization: `Bearer ${auth.accessToken}` },
      payload: {
        ...reversalPayload,
        idempotencyKey: '44444444-4444-4444-8444-444444444444',
      },
    });
    expect(secondApproval.statusCode).toBe(409);

    const excessiveAmount = (Number(originalBalance) + 1).toFixed(2);
    const negativeOverdraft = await server.inject({
      method: 'POST', url: correctionsUrl,
      headers: { authorization: `Bearer ${auth.accessToken}` },
      payload: {
        ...correctionPayload,
        idempotencyKey: '33333333-3333-4333-8333-333333333333',
        correctionType: 'NEGATIVE', amount: excessiveAmount,
        expectedCurrentBalance: originalBalance,
        expectedProjectedBalance: '-1.00',
      },
    });
    expect(negativeOverdraft.statusCode).toBe(409);

    const persisted = await pool.query<{
      correction_count: string;
      reversal_count: string;
      approval_count: string;
      audit_count: string;
      balance: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM balance_corrections WHERE id = $1)
           AS correction_count,
         (SELECT count(*)::text FROM ledger_entries
          WHERE reversal_of_entry_id = $2) AS reversal_count,
         (SELECT count(*)::text FROM ledger_reversal_approvals WHERE id = $3)
           AS approval_count,
         (SELECT count(*)::text FROM audit_logs
          WHERE record_id IN ($1, $3)
            AND action_type IN ('BALANCE_CORRECTION_CREATED','LEDGER_REVERSAL_APPROVED'))
           AS audit_count,
         (SELECT calculated_balance::text FROM settlement_accounts WHERE id = $4)
           AS balance`,
      [
        correctionPayload.idempotencyKey, correction.correction.ledgerEntryId,
        reversalPayload.idempotencyKey, account.rows[0].id,
      ],
    );
    expect(persisted.rows[0]).toEqual({
      correction_count: '1', reversal_count: '1', approval_count: '1',
      audit_count: '2', balance: originalBalance,
    });
    await expect(pool.query(
      `UPDATE balance_corrections SET reason = 'mutated' WHERE id = $1`,
      [correctionPayload.idempotencyKey],
    )).rejects.toThrow(/immutable/iu);
    await expect(pool.query(
      `DELETE FROM ledger_reversal_approvals WHERE id = $1`,
      [reversalPayload.idempotencyKey],
    )).rejects.toThrow(/immutable/iu);
  });

  it('creates and submits categorized daily reconciliation snapshots', async () => {
    const passwordHash = await hash('V2-Reconciliation-Cashier-Password!', 4);
    const cashier = await pool.query<{
      membership_id: string;
      role_id: string;
      work_id: string;
    }>(
      `WITH cashier_user AS (
         INSERT INTO users (full_name, phone_number, email, password_hash, global_status)
         VALUES ('Reconciliation Cashier', '+251911000097',
                 'reconciliation-cashier@example.test', $1, 'ACTIVE')
         RETURNING id
       ), cashier_membership AS (
         INSERT INTO business_user_memberships (
           user_id, business_id, status, joined_at, approved_at
         ) SELECT id, $2, 'ACTIVE', now(), now() FROM cashier_user
         RETURNING id
       ), cashier_role AS (
         INSERT INTO membership_role_assignments (
           membership_id, role_code, status, approved_at, assigned_at
         ) SELECT id, 'CASHIER', 'ACTIVE', now(), now() FROM cashier_membership
         RETURNING id
       ), cashier_work AS (
         INSERT INTO user_work_assignments (
           membership_role_id, business_id, assignment_type, branch_id,
           status, is_primary_context, approved_at, assigned_at
         ) SELECT id, $2, 'BRANCH', $3, 'ACTIVE', true, now(), now()
           FROM cashier_role
         RETURNING id
       )
       SELECT cashier_membership.id AS membership_id,
              cashier_role.id AS role_id, cashier_work.id AS work_id
       FROM cashier_membership, cashier_role, cashier_work`,
      [passwordHash, businessId, branchId],
    );
    await pool.query(
      `INSERT INTO reconciliation_schedules (
         business_id, scope_type, branch_id, day_of_week, closing_time,
         timezone, status, created_by_membership_id
       ) VALUES ($1,'BRANCH',$2,6,'23:59:59','Africa/Addis_Ababa','ACTIVE',$3)`,
      [businessId, branchId, membershipId],
    );
    const context = cashier.rows[0];
    const login = await app.getHttpAdapter().getInstance().inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: {
        identity: 'reconciliation-cashier@example.test',
        password: 'V2-Reconciliation-Cashier-Password!', devicePlatform: 'web',
        context: {
          membershipId: context.membership_id,
          membershipRoleId: context.role_id,
          workAssignmentId: context.work_id,
        },
      },
    });
    const auth = responseData<{ accessToken: string }>(login);
    const snapshot = await pool.query<{ id: string; calculated: string }>(
      `SELECT account.id,
              COALESCE(SUM(CASE WHEN entry.direction = 'CREDIT'
                                THEN entry.amount ELSE -entry.amount END), 0)
                ::numeric(18,2)::text AS calculated
       FROM settlement_accounts account
       LEFT JOIN ledger_entries entry ON entry.settlement_account_id = account.id
         AND entry.actual_transaction_at <
           (('2026-08-08'::date + '23:59:59'::time)
             AT TIME ZONE 'Africa/Addis_Ababa')
       WHERE account.business_id = $1 AND account.branch_id = $2
         AND account.status = 'ACTIVE'
       GROUP BY account.id LIMIT 1`,
      [businessId, branchId],
    );
    const url =
      `/api/v1/businesses/${businessId}/branches/${branchId}/reconciliations`;
    const payload = {
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      settlementAccountId: snapshot.rows[0].id,
      reconciliationDate: '2026-08-08',
      actualBankBalance: snapshot.rows[0].calculated,
      description: 'Cashier daily settlement reconciliation',
    };
    const created = await app.getHttpAdapter().getInstance().inject({
      method: 'POST', url,
      headers: { authorization: `Bearer ${auth.accessToken}` }, payload,
    });
    expect(created.statusCode).toBe(201);
    const draft = responseData<{
      replayed: boolean;
      reconciliation: {
        id: string;
        status: string;
        calculatedBalance: string;
        difference: string;
        totals: { manualDeposits: string; withdrawals: string };
      };
    }>(created);
    expect(draft).toMatchObject({
      replayed: false,
      reconciliation: {
        id: payload.idempotencyKey, status: 'DRAFT',
        calculatedBalance: snapshot.rows[0].calculated, difference: '0.00',
      },
    });
    expect(Number(draft.reconciliation.totals.manualDeposits)).toBeGreaterThan(0);
    expect(Number(draft.reconciliation.totals.withdrawals)).toBeGreaterThan(0);
    const replay = await app.getHttpAdapter().getInstance().inject({
      method: 'POST', url,
      headers: { authorization: `Bearer ${auth.accessToken}` }, payload,
    });
    expect(responseData<{ replayed: boolean }>(replay).replayed).toBe(true);

    const submitted = await app.getHttpAdapter().getInstance().inject({
      method: 'POST', url: `${url}/${payload.idempotencyKey}/submit`,
      headers: { authorization: `Bearer ${auth.accessToken}` },
    });
    expect(responseData<{
      reconciliation: { status: string };
    }>(submitted).reconciliation.status).toBe('MATCHED');
    const submitReplay = await app.getHttpAdapter().getInstance().inject({
      method: 'POST', url: `${url}/${payload.idempotencyKey}/submit`,
      headers: { authorization: `Bearer ${auth.accessToken}` },
    });
    expect(responseData<{ replayed: boolean }>(submitReplay).replayed).toBe(true);
    const detail = await app.getHttpAdapter().getInstance().inject({
      method: 'GET', url: `${url}/${payload.idempotencyKey}`,
      headers: { authorization: `Bearer ${auth.accessToken}` },
    });
    expect(responseData<{ history: Array<{ toStatus: string }> }>(detail).history
      .map((item) => item.toStatus)).toEqual(['DRAFT', 'SUBMITTED', 'MATCHED']);

    const discrepancyPayload = {
      ...payload,
      idempotencyKey: '12121212-1212-4212-8212-121212121212',
      actualBankBalance: (Number(snapshot.rows[0].calculated) + 1).toFixed(2),
      differenceExplanation: 'Bank statement is one birr above the ledger snapshot',
    };
    const discrepancyDraft = await app.getHttpAdapter().getInstance().inject({
      method: 'POST', url,
      headers: { authorization: `Bearer ${auth.accessToken}` },
      payload: discrepancyPayload,
    });
    expect(discrepancyDraft.statusCode).toBe(201);
    const discrepancy = await app.getHttpAdapter().getInstance().inject({
      method: 'POST', url: `${url}/${discrepancyPayload.idempotencyKey}/submit`,
      headers: { authorization: `Bearer ${auth.accessToken}` },
    });
    expect(responseData<{
      reconciliation: { status: string; difference: string };
    }>(discrepancy).reconciliation).toMatchObject({
      status: 'DISCREPANCY', difference: '1.00',
    });

    const managerLogin = await app.getHttpAdapter().getInstance().inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: {
        identity: 'v2-manager@example.test',
        password: 'V2-Manager-Integration-Password!', devicePlatform: 'web',
        context: { membershipId, membershipRoleId, workAssignmentId },
      },
    });
    const managerAuth = responseData<{ accessToken: string }>(managerLogin);
    const managerHeaders = {
      authorization: `Bearer ${managerAuth.accessToken}`,
    };
    const approved = await app.getHttpAdapter().getInstance().inject({
      method: 'POST', url: `${url}/${payload.idempotencyKey}/decision`,
      headers: managerHeaders,
      payload: {
        decision: 'APPROVED',
        reason: 'Manager verified the matching bank statement evidence',
      },
    });
    expect(approved.statusCode).toBe(201);
    expect(responseData<{
      replayed: boolean;
      reconciliation: { status: string; decisionReason: string };
    }>(approved)).toMatchObject({
      replayed: false,
      reconciliation: {
        status: 'APPROVED',
        decisionReason: 'Manager verified the matching bank statement evidence',
      },
    });
    const returned = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: `${url}/${discrepancyPayload.idempotencyKey}/decision`,
      headers: managerHeaders,
      payload: {
        decision: 'RETURNED',
        reason: 'Cashier must attach corrected bank statement evidence',
      },
    });
    expect(responseData<{
      reconciliation: { status: string };
    }>(returned).reconciliation.status).toBe('RETURNED');
    const returnedReplay = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: `${url}/${discrepancyPayload.idempotencyKey}/decision`,
      headers: managerHeaders,
      payload: {
        decision: 'RETURNED',
        reason: 'Cashier must attach corrected bank statement evidence',
      },
    });
    expect(responseData<{ replayed: boolean }>(returnedReplay).replayed).toBe(true);

    const replacementPayload = {
      ...discrepancyPayload,
      idempotencyKey: '34343434-3434-4434-8434-343434343434',
      description: 'Replacement daily settlement reconciliation',
    };
    const replacement = await app.getHttpAdapter().getInstance().inject({
      method: 'POST', url,
      headers: { authorization: `Bearer ${auth.accessToken}` },
      payload: replacementPayload,
    });
    expect(responseData<{
      reconciliation: { status: string; sequenceNo: number };
    }>(replacement).reconciliation).toMatchObject({
      status: 'DRAFT', sequenceNo: 3,
    });
    const returnedDetail = await app.getHttpAdapter().getInstance().inject({
      method: 'GET', url: `${url}/${discrepancyPayload.idempotencyKey}`,
      headers: managerHeaders,
    });
    expect(responseData<{
      status: string;
      history: Array<{ toStatus: string }>;
    }>(returnedDetail)).toMatchObject({ status: 'SUPERSEDED' });
    expect(responseData<{
      history: Array<{ toStatus: string }>;
    }>(returnedDetail).history.map((item) => item.toStatus)).toEqual([
      'DRAFT', 'SUBMITTED', 'DISCREPANCY', 'RETURNED', 'SUPERSEDED',
    ]);
    const managerQueue = await app.getHttpAdapter().getInstance().inject({
      method: 'GET', url: `${url}?status=APPROVED`, headers: managerHeaders,
    });
    expect(responseData<Array<{ id: string }>>(managerQueue)
      .map((item) => item.id)).toContain(payload.idempotencyKey);
    const persistedDecision = await pool.query<{
      decision_count: string;
      history_count: string;
    }>(
      `SELECT
         (SELECT COUNT(*)::text FROM audit_logs
          WHERE record_id IN ($1,$2)
            AND action_type IN ('RECONCILIATION_APPROVED','RECONCILIATION_RETURNED'))
           AS decision_count,
         (SELECT COUNT(*)::text FROM reconciliation_status_history
          WHERE reconciliation_id IN ($1,$2)
            AND to_status IN ('APPROVED','RETURNED','SUPERSEDED'))
           AS history_count`,
      [payload.idempotencyKey, discrepancyPayload.idempotencyKey],
    );
    expect(persistedDecision.rows[0]).toEqual({
      decision_count: '2', history_count: '3',
    });
    await expect(pool.query(
      `UPDATE reconciliations SET actual_bank_balance = actual_bank_balance + 1
       WHERE id = $1`,
      [payload.idempotencyKey],
    )).rejects.toThrow(/immutable/iu);
    await expect(pool.query(
      `UPDATE reconciliations SET decision_reason = 'Changed outside workflow'
       WHERE id = $1`,
      [payload.idempotencyKey],
    )).rejects.toThrow(/decision metadata is immutable/iu);
  });

  it('enforces immutable subscription purchase snapshots and payment proofs', async () => {
    const order = await pool.query<{ id: string }>(
      `SELECT purchase.id FROM subscription_orders purchase
       WHERE NOT EXISTS (
         SELECT 1 FROM subscription_purchase_proofs proof
         WHERE proof.order_id = purchase.id
       ) ORDER BY purchase.created_at LIMIT 1`,
    );
    expect(order.rows[0]).toBeDefined();
    await pool.query(
      `INSERT INTO subscription_purchase_proofs (
         order_id, object_key, file_name, mime_type, size_bytes, sha256,
         extraction_state, candidate_count, uploaded_by_user_id
       ) VALUES ($1,$2,'proof.png','image/png',16,$3,'NO_QR',0,$4)`,
      [order.rows[0].id, `private/subscription-proof/${order.rows[0].id}`,
       'c'.repeat(64), userId],
    );
    await expect(pool.query(
      `UPDATE subscription_orders SET price_snapshot = price_snapshot + 1
       WHERE id = $1`, [order.rows[0].id],
    )).rejects.toThrow(/purchase snapshot is immutable/iu);
    await expect(pool.query(
      `UPDATE subscription_purchase_proofs SET file_name = 'changed.png'
       WHERE order_id = $1`, [order.rows[0].id],
    )).rejects.toThrow(/immutable/iu);
  });

  it('matches and verifies a subscription before atomically granting credits', async () => {
    const orderId = '56565656-5656-4656-8656-565656565656';
    const verificationId = '57575757-5757-4757-8757-575757575757';
    const subscriptionId = '58585858-5858-4858-8858-585858585858';
    const creditLotId = '59595959-5959-4959-8959-595959595959';
    const setup = await pool.query<{
      plan_id: string; bank_id: string; bank_code: string; account_id: string;
    }>(
      `SELECT plan.id AS plan_id, account.bank_id,
              bank.verifyet_bank_identifier AS bank_code, account.id AS account_id
       FROM subscription_plans plan
       CROSS JOIN LATERAL (
         SELECT * FROM platform_settlement_accounts
         WHERE status = 'ACTIVE' ORDER BY created_at LIMIT 1
       ) account
       JOIN supported_banks bank ON bank.id = account.bank_id
       WHERE plan.name = 'Starter'`,
    );
    await pool.query(
      `UPDATE platform_settlement_accounts SET normalized_account_suffix = '12345678'
       WHERE id = $1`, [setup.rows[0].account_id],
    );
    await pool.query(
      `INSERT INTO subscription_orders (
         id, idempotency_key, business_id, branch_id, plan_id,
         plan_name_snapshot, credits_snapshot, price_snapshot,
         duration_days_snapshot, purchasing_membership_id, payment_bank_id,
         platform_account_id, status
       ) SELECT $1,$1,$2,$3,plan.id,plan.name,plan.credits,plan.price_etb,
                plan.duration_days,$4,$5,$6,'PROOF_RECEIVED'
         FROM subscription_plans plan WHERE plan.id = $7`,
      [orderId, businessId, branchId, membershipId, setup.rows[0].bank_id,
       setup.rows[0].account_id, setup.rows[0].plan_id],
    );
    await pool.query(
      `INSERT INTO subscription_purchase_proofs (
         order_id, object_key, file_name, mime_type, size_bytes, sha256,
         extraction_state, candidate_count, parsed_bank_code, parsed_reference,
         parsed_amount_etb, parsed_account_suffix, parsed_transaction_date,
         parsed_transaction_time, uploaded_by_user_id
       ) VALUES ($1,$2,'subscription.png','image/png',32,$3,'SINGLE_QR',1,
         $4,'SUB-FT-001',8000.00,'12345678','2026-08-09','12:30:00',$5)`,
      [orderId, `private/subscription-proof/${orderId}`, 'd'.repeat(64),
       setup.rows[0].bank_code, userId],
    );
    const prepared = await centralDao.transaction((transaction) =>
      subscriptionVerifications.prepareWithin(transaction, {
        id: verificationId, idempotencyKey: `subscription:verify:${orderId}`,
        deferredId: '60606060-6060-4060-8060-606060606060',
        creditEventKey: `subscription-verification:${orderId}`,
        orderId, businessId, branchId,
      }),
    );
    expect(prepared.request).toEqual({
      bankCode: setup.rows[0].bank_code, transactionReference: 'SUB-FT-001',
      amount: '8000.00', receiverAccountSuffix: '12345678',
    });
    const requestedAt = new Date('2026-08-09T12:31:00.000Z');
    const provider = {
      result: 'VERIFIED' as const, httpStatus: 200,
      providerRequestId: 'verifyet-subscription-001', providerStatus: 'VERIFIED',
      requestedAt, respondedAt: new Date('2026-08-09T12:31:01.000Z'),
      providerBankId: setup.rows[0].bank_code,
      transactionReference: 'SUB-FT-001', amount: '8000.00',
      receiverAccountSuffix: '12345678',
      providerTransactionAt: new Date('2026-08-09T12:30:00.000Z'),
    };
    const outcomeInput = {
      verificationId, orderId, businessId, branchId, subscriptionId,
      invoiceId: '61616161-6161-4161-8161-616161616161',
      creditLotId, creditGrantEventKey: `subscription-grant:${orderId}`, provider,
    };
    const outcome = await centralDao.transaction((transaction) =>
      subscriptionVerifications.recordOutcomeWithin(transaction, outcomeInput));
    expect(outcome).toMatchObject({ decision: 'VERIFIED', replayed: false,
      grant: { creditLotId, creditsGranted: 10000 } });
    await expect(centralDao.transaction((transaction) =>
      subscriptionVerifications.recordOutcomeWithin(transaction, outcomeInput)))
      .resolves.toMatchObject({ decision: 'VERIFIED', replayed: true });
    const persisted = await pool.query<{
      order_status: string; verification_status: string;
      subscriptions: string; invoices: string; grants: string;
    }>(
      `SELECT purchase.status AS order_status,
        verification.verification_status,
        (SELECT count(*)::text FROM business_subscriptions WHERE order_id = $1)
          AS subscriptions,
        (SELECT count(*)::text FROM subscription_invoices WHERE order_id = $1)
          AS invoices,
        (SELECT count(*)::text FROM credit_transactions
         WHERE credit_event_key = $2) AS grants
       FROM subscription_orders purchase
       JOIN subscription_payment_verifications verification
         ON verification.order_id = purchase.id WHERE purchase.id = $1`,
      [orderId, `subscription-grant:${orderId}`],
    );
    expect(persisted.rows[0]).toEqual({
      order_status: 'VERIFIED', verification_status: 'VERIFIED',
      subscriptions: '1', invoices: '1', grants: '1',
    });
    await expect(pool.query(
      `UPDATE subscription_invoices SET amount_etb = amount_etb + 1
       WHERE order_id = $1`, [orderId],
    )).rejects.toThrow(/immutable/iu);
  });

  it('closes every plan for existing-credit and zero-credit branches with one invoice', async () => {
    const plans = await pool.query<{
      id: string; name: string; credits: string; price_etb: string;
      duration_days: number;
    }>(`SELECT id, name, credits::text, price_etb::text, duration_days
        FROM subscription_plans ORDER BY credits`);
    const account = await pool.query<{
      id: string; bank_id: string; bank_code: string;
    }>(`SELECT account.id, account.bank_id,
               bank.verifyet_bank_identifier AS bank_code
        FROM platform_settlement_accounts account
        JOIN supported_banks bank ON bank.id = account.bank_id
        WHERE account.status = 'ACTIVE' ORDER BY account.created_at LIMIT 1`);
    await pool.query(
      `UPDATE platform_settlement_accounts SET normalized_account_suffix = '12345678'
       WHERE id = $1`, [account.rows[0].id],
    );
    for (const plan of plans.rows) {
      for (const mode of ['existing', 'zero'] as const) {
        const key = `${plan.name.toLowerCase()}:${mode}`;
        const branch = deterministicUuid(`matrix:branch:${key}`);
        const order = deterministicUuid(`matrix:order:${key}`);
        const verification = deterministicUuid(`matrix:verification:${key}`);
        const subscription = deterministicUuid(`matrix:subscription:${key}`);
        const lot = deterministicUuid(`matrix:grant-lot:${key}`);
        const invoice = deterministicUuid(`matrix:invoice:${key}`);
        await pool.query(
          `INSERT INTO branches (
             id, branch_code, business_id, branch_name, address, city,
             sub_city, woreda, location_details, status,
             created_by_membership_id, activated_at
           ) VALUES ($1,$2,$3,$4,'Integration address','Addis Ababa',
             'Bole','01','Phase 7 matrix','ACTIVE',$5,now())`,
          [branch, `P7-${plan.credits}-${mode}`, businessId,
           `${plan.name} ${mode}`, membershipId],
        );
        await pool.query(
          `INSERT INTO branch_credit_wallets (
             branch_id, business_id, purchased_credits, available_credits
           ) VALUES ($1,$2,$3,$3)`,
          [branch, businessId, mode === 'existing' ? 2 : 0],
        );
        if (mode === 'existing') {
          await pool.query(
            `INSERT INTO credit_lots (
               id, business_id, branch_id, source_event_key,
               allocated_credits, starts_at, expires_at
             ) VALUES ($1,$2,$3,$4,2,now(),now() + interval '30 days')`,
            [deterministicUuid(`matrix:existing-lot:${key}`), businessId,
             branch, `matrix:existing:${key}`],
          );
        }
        const reference = `P7-${plan.credits}-${mode.toUpperCase()}`;
        await pool.query(
          `INSERT INTO subscription_orders (
             id, idempotency_key, business_id, branch_id, plan_id,
             plan_name_snapshot, credits_snapshot, price_snapshot,
             duration_days_snapshot, purchasing_membership_id,
             payment_bank_id, platform_account_id, status
           ) VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PROOF_RECEIVED')`,
          [order, businessId, branch, plan.id, plan.name, plan.credits,
           plan.price_etb, plan.duration_days, membershipId,
           account.rows[0].bank_id, account.rows[0].id],
        );
        await pool.query(
          `INSERT INTO subscription_purchase_proofs (
             order_id, object_key, file_name, mime_type, size_bytes, sha256,
             extraction_state, candidate_count, parsed_bank_code,
             parsed_reference, parsed_amount_etb, parsed_account_suffix,
             parsed_transaction_date, parsed_transaction_time,
             uploaded_by_user_id
           ) VALUES ($1,$2,'matrix.png','image/png',32,$3,'SINGLE_QR',1,
             $4,$5,$6,'12345678','2026-08-09','13:00:00',$7)`,
          [order, `private/subscription-matrix/${order}`, 'e'.repeat(64),
           account.rows[0].bank_code, reference, plan.price_etb, userId],
        );
        const prepared = await centralDao.transaction((transaction) =>
          subscriptionVerifications.prepareWithin(transaction, {
            id: verification,
            idempotencyKey: `subscription:verify:${order}`,
            deferredId: deterministicUuid(`matrix:deferred:${key}`),
            creditEventKey: `subscription-verification:${order}`,
            orderId: order, businessId, branchId: branch,
          }));
        expect(prepared.credit.decision).toBe(
          mode === 'existing' ? 'CHARGED' : 'DEFERRED');
        const provider = {
          result: 'VERIFIED' as const, httpStatus: 200,
          providerRequestId: `verifyet-${plan.credits}-${mode}`,
          providerStatus: 'VERIFIED',
          requestedAt: new Date('2026-08-09T13:01:00.000Z'),
          respondedAt: new Date('2026-08-09T13:01:01.000Z'),
          providerBankId: account.rows[0].bank_code,
          transactionReference: reference, amount: plan.price_etb,
          receiverAccountSuffix: '12345678',
          providerTransactionAt: new Date('2026-08-09T13:00:00.000Z'),
        };
        await centralDao.transaction((transaction) =>
          subscriptionVerifications.recordOutcomeWithin(transaction, {
            verificationId: verification, orderId: order, businessId,
            branchId: branch, subscriptionId: subscription, invoiceId: invoice,
            creditLotId: lot, creditGrantEventKey: `subscription-grant:${order}`,
            provider,
          }));
        const result = await pool.query<{
          available: string; invoices: string; grants: string; pending: string;
        }>(
          `SELECT wallet.available_credits::text AS available,
             (SELECT count(*)::text FROM subscription_invoices
              WHERE order_id = $2) AS invoices,
             (SELECT count(*)::text FROM credit_transactions
              WHERE credit_event_key = $3) AS grants,
             (SELECT count(*)::text FROM deferred_credit_deductions
              WHERE subscription_order_id = $2 AND status = 'PENDING') AS pending
           FROM branch_credit_wallets wallet WHERE wallet.branch_id = $1`,
          [branch, order, `subscription-grant:${order}`],
        );
        expect(result.rows[0]).toEqual({
          available: String(Number(plan.credits) + (mode === 'existing' ? 1 : -1)),
          invoices: '1', grants: '1', pending: '0',
        });
      }
    }
  });

  it('never activates, invoices or grants failed and duplicate subscription payments', async () => {
    const setup = await pool.query<{
      plan_id: string; price_etb: string; account_id: string;
      bank_id: string; bank_code: string;
    }>(
      `SELECT plan.id AS plan_id, plan.price_etb::text,
              account.id AS account_id, account.bank_id,
              bank.verifyet_bank_identifier AS bank_code
       FROM subscription_plans plan
       CROSS JOIN LATERAL (
         SELECT * FROM platform_settlement_accounts
         WHERE status = 'ACTIVE' ORDER BY created_at LIMIT 1
       ) account
       JOIN supported_banks bank ON bank.id = account.bank_id
       WHERE plan.name = 'Starter'`,
    );
    for (const scenario of ['FAILED', 'DUPLICATE'] as const) {
      const key = scenario.toLowerCase();
      const branch = deterministicUuid(`negative:branch:${key}`);
      const order = deterministicUuid(`negative:order:${key}`);
      const verification = deterministicUuid(`negative:verification:${key}`);
      const reference = scenario === 'DUPLICATE' ? 'SUB-FT-001' : 'P7-FAILED-001';
      await pool.query(
        `INSERT INTO branches (
           id, branch_code, business_id, branch_name, address, city,
           sub_city, woreda, location_details, status,
           created_by_membership_id, activated_at
         ) VALUES ($1,$2,$3,$4,'Integration address','Addis Ababa','Bole','01',
           'Phase 7 negative','ACTIVE',$5,now())`,
        [branch, `P7-${scenario}`, businessId, `P7 ${scenario}`, membershipId],
      );
      await pool.query(
        `INSERT INTO branch_credit_wallets (branch_id, business_id)
         VALUES ($1,$2)`, [branch, businessId],
      );
      await pool.query(
        `INSERT INTO subscription_orders (
           id, idempotency_key, business_id, branch_id, plan_id,
           plan_name_snapshot, credits_snapshot, price_snapshot,
           duration_days_snapshot, purchasing_membership_id,
           payment_bank_id, platform_account_id, status
         ) SELECT $1,$1,$2,$3,plan.id,plan.name,plan.credits,plan.price_etb,
                  plan.duration_days,$4,$5,$6,'PROOF_RECEIVED'
           FROM subscription_plans plan WHERE plan.id = $7`,
        [order, businessId, branch, membershipId, setup.rows[0].bank_id,
         setup.rows[0].account_id, setup.rows[0].plan_id],
      );
      await pool.query(
        `INSERT INTO subscription_purchase_proofs (
           order_id, object_key, file_name, mime_type, size_bytes, sha256,
           extraction_state, candidate_count, parsed_bank_code,
           parsed_reference, parsed_amount_etb, parsed_account_suffix,
           parsed_transaction_date, parsed_transaction_time, uploaded_by_user_id
         ) VALUES ($1,$2,'negative.png','image/png',32,$3,'SINGLE_QR',1,
           $4,$5,$6,'12345678','2026-08-09','14:00:00',$7)`,
        [order, `private/subscription-negative/${order}`, 'f'.repeat(64),
         setup.rows[0].bank_code, reference, setup.rows[0].price_etb, userId],
      );
      await centralDao.transaction((transaction) =>
        subscriptionVerifications.prepareWithin(transaction, {
          id: verification, idempotencyKey: `subscription:verify:${order}`,
          deferredId: deterministicUuid(`negative:deferred:${key}`),
          creditEventKey: `subscription-verification:${order}`,
          orderId: order, businessId, branchId: branch,
        }));
      const time = new Date('2026-08-09T14:01:00.000Z');
      const provider = scenario === 'FAILED' ? {
        result: 'FAILED' as const, httpStatus: 422,
        providerRequestId: 'verifyet-negative-failed', providerStatus: 'FAILED',
        requestedAt: time, respondedAt: new Date(time.getTime() + 1000),
        errorCode: 'NOT_FOUND',
      } : {
        result: 'VERIFIED' as const, httpStatus: 200,
        providerRequestId: 'verifyet-negative-duplicate', providerStatus: 'VERIFIED',
        requestedAt: time, respondedAt: new Date(time.getTime() + 1000),
        providerBankId: setup.rows[0].bank_code,
        transactionReference: reference, amount: setup.rows[0].price_etb,
        receiverAccountSuffix: '12345678', providerTransactionAt: time,
      };
      const outcome = await centralDao.transaction((transaction) =>
        subscriptionVerifications.recordOutcomeWithin(transaction, {
          verificationId: verification, orderId: order, businessId,
          branchId: branch,
          subscriptionId: deterministicUuid(`negative:subscription:${key}`),
          invoiceId: deterministicUuid(`negative:invoice:${key}`),
          creditLotId: deterministicUuid(`negative:lot:${key}`),
          creditGrantEventKey: `subscription-grant:${order}`, provider,
        }));
      expect(outcome.decision).toBe(scenario);
      const result = await pool.query<{
        order_status: string; available: string; subscriptions: string;
        invoices: string; grants: string; request_count: number;
      }>(
        `SELECT purchase.status AS order_status,
           wallet.available_credits::text AS available,
           verification.request_count,
           (SELECT count(*)::text FROM business_subscriptions
            WHERE order_id = $1) AS subscriptions,
           (SELECT count(*)::text FROM subscription_invoices
            WHERE order_id = $1) AS invoices,
           (SELECT count(*)::text FROM credit_transactions
            WHERE credit_event_key = $2) AS grants
         FROM subscription_orders purchase
         JOIN branch_credit_wallets wallet ON wallet.branch_id = purchase.branch_id
         JOIN subscription_payment_verifications verification
           ON verification.order_id = purchase.id WHERE purchase.id = $1`,
        [order, `subscription-grant:${order}`],
      );
      expect(result.rows[0]).toEqual({
        order_status: scenario, available: '0', subscriptions: '0',
        invoices: '0', grants: '0', request_count: 1,
      });
    }
  });

  it('classifies cross-day proof reuse and locks purchasing on the third attempt', async () => {
    const setup = await pool.query<{
      plan_id: string; price_etb: string; account_id: string;
      bank_id: string; bank_code: string;
    }>(
      `SELECT plan.id AS plan_id, plan.price_etb::text,
              account.id AS account_id, account.bank_id,
              bank.verifyet_bank_identifier AS bank_code
       FROM subscription_plans plan
       CROSS JOIN LATERAL (
         SELECT * FROM platform_settlement_accounts
         WHERE status = 'ACTIVE' ORDER BY created_at LIMIT 1
       ) account
       JOIN supported_banks bank ON bank.id = account.bank_id
       WHERE plan.name = 'Starter'`,
    );
    for (const attempt of [1, 2, 3]) {
      const branch = deterministicUuid(`phase8:fraud-branch:${attempt}`);
      const order = deterministicUuid(`phase8:fraud-order:${attempt}`);
      const verification = deterministicUuid(`phase8:fraud-verification:${attempt}`);
      const attemptedDate = `2026-08-${String(9 + attempt).padStart(2, '0')}`;
      await pool.query(
        `INSERT INTO branches (
           id, branch_code, business_id, branch_name, address, city,
           sub_city, woreda, location_details, status,
           created_by_membership_id, activated_at
         ) VALUES ($1,$2,$3,$4,'Integration address','Addis Ababa','Bole','01',
           'Phase 8 fraud','ACTIVE',$5,now())`,
        [branch, `P8-FRAUD-${attempt}`, businessId,
         `Phase 8 Fraud ${attempt}`, membershipId],
      );
      await pool.query(
        `INSERT INTO branch_credit_wallets (branch_id, business_id)
         VALUES ($1,$2)`, [branch, businessId],
      );
      await pool.query(
        `INSERT INTO subscription_orders (
           id, idempotency_key, business_id, branch_id, plan_id,
           plan_name_snapshot, credits_snapshot, price_snapshot,
           duration_days_snapshot, purchasing_membership_id,
           payment_bank_id, platform_account_id, status
         ) SELECT $1,$1,$2,$3,plan.id,plan.name,plan.credits,plan.price_etb,
                  plan.duration_days,$4,$5,$6,'PROOF_RECEIVED'
           FROM subscription_plans plan WHERE plan.id = $7`,
        [order, businessId, branch, membershipId, setup.rows[0].bank_id,
         setup.rows[0].account_id, setup.rows[0].plan_id],
      );
      await pool.query(
        `INSERT INTO subscription_purchase_proofs (
           order_id, object_key, file_name, mime_type, size_bytes, sha256,
           extraction_state, candidate_count, parsed_bank_code,
           parsed_reference, parsed_amount_etb, parsed_account_suffix,
           parsed_transaction_date, parsed_transaction_time, uploaded_by_user_id
         ) VALUES ($1,$2,'fraud.png','image/png',32,$3,'SINGLE_QR',1,
           $4,'SUB-FT-001',$5,'12345678',$6,'14:00:00',$7)`,
        [order, `private/subscription-fraud/${order}`, 'a'.repeat(64),
         setup.rows[0].bank_code, setup.rows[0].price_etb,
         attemptedDate, userId],
      );
      await centralDao.transaction((transaction) =>
        subscriptionVerifications.prepareWithin(transaction, {
          id: verification, idempotencyKey: `subscription:verify:${order}`,
          deferredId: deterministicUuid(`phase8:fraud-deferred:${attempt}`),
          creditEventKey: `subscription-verification:${order}`,
          orderId: order, businessId, branchId: branch,
        }));
      const providerTime = new Date(`${attemptedDate}T14:01:00.000Z`);
      const outcome = await centralDao.transaction((transaction) =>
        subscriptionVerifications.recordOutcomeWithin(transaction, {
          verificationId: verification, orderId: order, businessId,
          branchId: branch,
          subscriptionId: deterministicUuid(`phase8:fraud-subscription:${attempt}`),
          invoiceId: deterministicUuid(`phase8:fraud-invoice:${attempt}`),
          creditLotId: deterministicUuid(`phase8:fraud-lot:${attempt}`),
          creditGrantEventKey: `subscription-grant:${order}`,
          provider: {
            result: 'VERIFIED', httpStatus: 200,
            providerRequestId: `phase8-fraud-provider-${attempt}`,
            providerStatus: 'VERIFIED', requestedAt: providerTime,
            respondedAt: new Date(providerTime.getTime() + 1000),
            providerBankId: setup.rows[0].bank_code,
            transactionReference: 'SUB-FT-001', amount: setup.rows[0].price_etb,
            receiverAccountSuffix: '12345678', providerTransactionAt: providerTime,
          },
        }));
      expect(outcome).toMatchObject({
        decision: 'DUPLICATE', duplicateClassification: 'CROSS_DAY_FRAUD',
        fraudAttemptNumber: attempt, purchaseLocked: attempt === 3,
      });
    }
    const evidence = await pool.query<{
      attempts: string; locks: string; subscriptions: string;
      invoices: string; grants: string; alerts: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM subscription_fraud_attempts
          WHERE business_id = $1) AS attempts,
         (SELECT count(*)::text FROM subscription_purchase_locks
          WHERE business_id = $1 AND status = 'ACTIVE') AS locks,
         (SELECT count(*)::text FROM business_subscriptions subscription
          JOIN subscription_orders purchase ON purchase.id = subscription.order_id
          WHERE purchase.business_id = $1 AND purchase.id::text LIKE '%') AS subscriptions,
         (SELECT count(*)::text FROM subscription_invoices invoice
          JOIN subscription_orders purchase ON purchase.id = invoice.order_id
          WHERE purchase.business_id = $1
            AND purchase.branch_id IN (
              SELECT branch_id FROM subscription_fraud_attempts WHERE business_id = $1
            )) AS invoices,
         (SELECT count(*)::text FROM credit_transactions
          WHERE credit_event_key IN (
            SELECT 'subscription-grant:' || order_id::text
            FROM subscription_fraud_attempts WHERE business_id = $1
          )) AS grants,
         (SELECT count(*)::text FROM security_alerts
          WHERE business_id = $1
            AND alert_type = 'SUBSCRIPTION_CROSS_DAY_REUSE') AS alerts`,
      [businessId],
    );
    expect(evidence.rows[0]).toMatchObject({
      attempts: '3', locks: '1', invoices: '0', grants: '0', alerts: '3',
    });
    const reviews = await fraudReviews.list({
      status: 'OPEN', businessId, limit: 10, offset: 0,
    });
    expect(reviews).toHaveLength(3);
    expect(reviews.map((review) => review.severity).sort()).toEqual([
      'CRITICAL', 'HIGH', 'HIGH',
    ]);
    expect(reviews.every((review) =>
      review.maskedTransactionReference.endsWith('-001') &&
      review.maskedTransactionReference !== 'SUB-FT-001')).toBe(true);
    await expect(fraudReviews.require(reviews[0].id)).resolves.toMatchObject({
      id: reviews[0].id, business: { id: businessId },
      alert: { acknowledged: false },
    });
    await expect(centralDao.transaction((transaction) =>
      subscriptionPurchases.createWithin(transaction, {
        id: deterministicUuid('phase8:locked-purchase'), businessId,
        branchId, planId: setup.rows[0].plan_id,
        paymentBankId: setup.rows[0].bank_id,
        actor: {
          identityType: 'BUSINESS_USER', userId, sessionId: 'phase8-session',
          role: 'PRIMARY_OWNER', businessIds: [businessId], membershipId,
          membershipRoleId,
        },
      }))).rejects.toBeInstanceOf(SubscriptionPurchaseLockedError);
    const firstAttempt = await pool.query<{ id: string }>(
      `SELECT id FROM subscription_fraud_attempts
       WHERE business_id = $1 ORDER BY qualifying_attempt_number LIMIT 1`,
      [businessId],
    );
    await expect(pool.query(
      `UPDATE subscription_fraud_attempts SET transaction_reference = 'CHANGED'
       WHERE id = $1`, [firstAttempt.rows[0].id],
    )).rejects.toThrow(/immutable/iu);

    await pool.query(
      `UPDATE membership_role_assignments SET role_code = 'PRIMARY_OWNER'
       WHERE id = $1`, [membershipRoleId],
    );
    const recoveryCode = 'PGRC-integration-secure-single-use-code';
    const recoveryId = deterministicUuid('phase8:recovery-code');
    const issued = await centralDao.transaction((transaction) =>
      recoveryAuthorizations.issueWithin(transaction, {
        id: recoveryId, requestKey: deterministicUuid('phase8:recovery-request'),
        fraudReviewId: reviews[0].id,
        codeHash: createHash('sha256').update(recoveryCode).digest('hex'),
        deliveredToUserId: userId,
        reviewNote: 'Integration identity and evidence review approved',
        expiresInMinutes: 15, platformAdminId: adminId,
      }));
    expect(issued).toMatchObject({ status: 'ACTIVE', deliveredToUserId: userId });
    const redeemed = await centralDao.transaction((transaction) =>
      recoveryAuthorizations.redeemWithin(transaction, {
        businessId, userId,
        codeHash: createHash('sha256').update(recoveryCode).digest('hex'),
      }));
    expect(redeemed).toMatchObject({ id: recoveryId, status: 'USED' });
    await expect(centralDao.transaction((transaction) =>
      recoveryAuthorizations.redeemWithin(transaction, {
        businessId, userId,
        codeHash: createHash('sha256').update(recoveryCode).digest('hex'),
      }))).rejects.toBeInstanceOf(RecoveryAuthorizationInvalidError);
    await expect(centralDao.transaction((transaction) =>
      subscriptionPurchases.createWithin(transaction, {
        id: deterministicUuid('phase8:unlocked-purchase'), businessId,
        branchId, planId: setup.rows[0].plan_id,
        paymentBankId: setup.rows[0].bank_id,
        actor: {
          identityType: 'BUSINESS_USER', userId, sessionId: 'phase8-session',
          role: 'PRIMARY_OWNER', businessIds: [businessId], membershipId,
          membershipRoleId,
        },
      }))).resolves.toMatchObject({ replayed: false });
    const recoveryState = await pool.query<{
      recovery_status: string; lock_status: string; open_flags: string;
    }>(
      `SELECT recovery.status AS recovery_status, purchase_lock.status AS lock_status,
         (SELECT count(*)::text FROM fraud_flags
          WHERE business_id = recovery.business_id AND status = 'OPEN'
            AND event_type IN ('CROSS_DAY_DUPLICATE','THREE_DUPLICATES')) AS open_flags
       FROM recovery_codes recovery
       JOIN subscription_purchase_locks purchase_lock
         ON purchase_lock.id = recovery.purchase_lock_id
       WHERE recovery.id = $1`, [recoveryId],
    );
    expect(recoveryState.rows[0]).toEqual({
      recovery_status: 'USED', lock_status: 'UNLOCKED', open_flags: '0',
    });
  });

  it('returns a branch-scoped financial summary with Manual Deposits separate', async () => {
    const server = app.getHttpAdapter().getInstance();
    const login = await server.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: {
        identity: 'v2-manager@example.test',
        password: 'V2-Manager-Integration-Password!', devicePlatform: 'web',
        context: { membershipId, membershipRoleId, workAssignmentId },
      },
    });
    expect(login.statusCode).toBe(201);
    const auth = responseData<{ accessToken: string }>(login);
    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/businesses/${businessId}/reports/financial-summary` +
        '?dateFrom=2026-01-01&dateTo=2026-12-31',
      headers: { authorization: `Bearer ${auth.accessToken}` },
    });
    expect(response.statusCode).toBe(200);
    const report = responseData<{
      businessId: string; branchId: string; entryCount: number;
      categories: Array<{ entryType: string; entryCount: number }>;
    }>(response);
    expect(report).toMatchObject({ businessId, branchId });
    expect(report.entryCount).toBeGreaterThan(0);
    expect(report.categories).toEqual(expect.arrayContaining([
      expect.objectContaining({ entryType: 'MANUAL_DEPOSIT' }),
      expect.objectContaining({ entryType: 'VERIFIED_DEPOSIT' }),
    ]));

    const override = await server.inject({
      method: 'GET',
      url: `/api/v1/businesses/${businessId}/reports/financial-summary` +
        '?dateFrom=2026-01-01&dateTo=2026-12-31' +
        '&branchId=00000000-0000-4000-8000-000000000001',
      headers: { authorization: `Bearer ${auth.accessToken}` },
    });
    expect(override.statusCode).toBe(403);
  });

  it('isolates business operations and global provider health reports', async () => {
    const server = app.getHttpAdapter().getInstance();
    const managerLogin = await server.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: {
        identity: 'v2-manager@example.test',
        password: 'V2-Manager-Integration-Password!', devicePlatform: 'web',
        context: { membershipId, membershipRoleId, workAssignmentId },
      },
    });
    const manager = responseData<{ accessToken: string }>(managerLogin);
    const businessReport = await server.inject({
      method: 'GET',
      url: `/api/v1/businesses/${businessId}/reports/operational-summary` +
        '?dateFrom=2026-01-01&dateTo=2026-12-31',
      headers: { authorization: `Bearer ${manager.accessToken}` },
    });
    expect(businessReport.statusCode).toBe(200);
    const businessData = responseData<{
      businessId: string; branchId: string;
      verification: { statuses: unknown[] };
      credits: { purchased: string; available: string };
      subscriptions: { statuses: unknown[] };
      fraud: { attemptCount: number };
    }>(businessReport);
    expect(businessData.businessId).toBe(businessId);
    expect(businessData.branchId).toBe(branchId);
    expect(Array.isArray(businessData.verification.statuses)).toBe(true);
    expect(typeof businessData.credits.purchased).toBe('string');
    expect(typeof businessData.credits.available).toBe('string');
    expect(Array.isArray(businessData.subscriptions.statuses)).toBe(true);
    expect(typeof businessData.fraud.attemptCount).toBe('number');

    const deniedProvider = await server.inject({
      method: 'GET',
      url: '/api/v1/platform/reports/provider-summary' +
        '?dateFrom=2026-08-01&dateTo=2026-08-31',
      headers: { authorization: `Bearer ${manager.accessToken}` },
    });
    expect(deniedProvider.statusCode).toBe(403);

    const adminLogin = await server.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: {
        identity: 'v2-admin@example.test',
        password: 'V2-Admin-Integration-Password!', devicePlatform: 'web',
      },
    });
    const admin = responseData<{ accessToken: string }>(adminLogin);
    const providerReport = await server.inject({
      method: 'GET',
      url: '/api/v1/platform/reports/provider-summary' +
        '?dateFrom=2026-08-01&dateTo=2026-08-31',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    expect(providerReport.statusCode).toBe(200);
    const providerData = responseData<{
      requests: { statuses: unknown[]; operations: unknown[] };
      responses: { classes: unknown[] };
      incidents: { open: number; acknowledged: number };
    }>(providerReport);
    expect(Array.isArray(providerData.requests.statuses)).toBe(true);
    expect(Array.isArray(providerData.requests.operations)).toBe(true);
    expect(Array.isArray(providerData.responses.classes)).toBe(true);
    expect(typeof providerData.incidents.open).toBe('number');
    expect(typeof providerData.incidents.acknowledged).toBe('number');
  });

  it('persists, replays, leases and completes an owner-scoped report export', async () => {
    const server = app.getHttpAdapter().getInstance();
    const login = await server.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: {
        identity: 'v2-manager@example.test',
        password: 'V2-Manager-Integration-Password!', devicePlatform: 'web',
        context: { membershipId, membershipRoleId, workAssignmentId },
      },
    });
    const auth = responseData<{ accessToken: string }>(login);
    const url = `/api/v1/businesses/${businessId}/reports/exports`;
    const payload = {
      idempotencyKey: '91919191-9191-4191-8191-919191919191',
      reportType: 'FINANCIAL_SUMMARY',
      dateFrom: '2026-01-01', dateTo: '2026-12-31',
    };
    const created = await server.inject({
      method: 'POST', url, payload,
      headers: { authorization: `Bearer ${auth.accessToken}` },
    });
    expect(created.statusCode).toBe(201);
    const job = responseData<{
      id: string; branchId: string; status: string; attemptCount: number;
    }>(created);
    expect(job).toMatchObject({
      branchId, status: 'QUEUED', attemptCount: 0,
    });
    const replay = await server.inject({
      method: 'POST', url, payload,
      headers: { authorization: `Bearer ${auth.accessToken}` },
    });
    expect(responseData<{ id: string }>(replay).id).toBe(job.id);

    const override = await server.inject({
      method: 'POST', url,
      payload: {
        ...payload,
        idempotencyKey: '92929292-9292-4292-8292-929292929292',
        branchId: '00000000-0000-4000-8000-000000000001',
      },
      headers: { authorization: `Bearer ${auth.accessToken}` },
    });
    expect(override.statusCode).toBe(403);

    const exportDao = app.get(ReportExportDao);
    const claim = await exportDao.claimNext();
    expect(claim).toMatchObject({
      jobId: job.id, businessId, branchId, attemptNo: 1,
    });
    await exportDao.complete(claim!, {
      objectKey: `private/report-exports/${businessId}/${job.id}.csv`,
      fileName: `payguard-financial-summary-${job.id}.csv`,
      sizeBytes: 20, contentType: 'text/csv; charset=utf-8',
      sha256: 'a'.repeat(64),
    });
    const status = await server.inject({
      method: 'GET', url: `${url}/${job.id}`,
      headers: { authorization: `Bearer ${auth.accessToken}` },
    });
    expect(responseData<{ status: string; attemptCount: number }>(status))
      .toMatchObject({ status: 'READY', attemptCount: 1 });
  });

  it('queries immutable audit records within business, branch and platform scope', async () => {
    const auditId = deterministicUuid('phase9:audit-query');
    await pool.query(
      `INSERT INTO audit_logs (
         id, user_id, membership_id, role_code, business_id, branch_id,
         action_type, record_type, record_id, new_value, result, correlation_id
       ) VALUES ($1,$2,$3,'MANAGER',$4,$5,'AUDIT_QUERY_TEST','CONFIGURATION',$1,
                 '{"status":"ACTIVE"}'::jsonb,'SUCCESS','phase9-audit-correlation')`,
      [auditId, userId, membershipId, businessId, branchId],
    );
    await expect(pool.query(
      `UPDATE audit_logs SET result = 'FAILURE' WHERE id = $1`, [auditId],
    )).rejects.toMatchObject({ code: '55000' });
    await expect(pool.query(
      'DELETE FROM audit_logs WHERE id = $1', [auditId],
    )).rejects.toMatchObject({ code: '55000' });

    const server = app.getHttpAdapter().getInstance();
    const managerLogin = await server.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: {
        identity: 'v2-manager@example.test',
        password: 'V2-Manager-Integration-Password!', devicePlatform: 'web',
        context: { membershipId, membershipRoleId, workAssignmentId },
      },
    });
    const manager = responseData<{ accessToken: string }>(managerLogin);
    const managerSession = await pool.query<{ id: string }>(
      `SELECT id FROM user_sessions
       WHERE user_id = $1 AND revoked_at IS NULL
       ORDER BY login_at DESC LIMIT 1`,
      [userId],
    );
    expect(managerSession.rowCount).toBe(1);
    const preference = await server.inject({
      method: 'PATCH', url: '/api/v1/notifications/preferences',
      headers: { authorization: `Bearer ${manager.accessToken}` },
      payload: {
        notificationType: 'TRANSACTION_UPDATE',
        inAppEnabled: true,
        pushEnabled: false,
      },
    });
    expect(preference.statusCode).toBe(200);
    const registeredDevice = await server.inject({
      method: 'POST', url: '/api/v1/notifications/devices',
      headers: { authorization: `Bearer ${manager.accessToken}` },
      payload: {
        platform: 'web',
        token: 'phase9-audit-device-token-that-is-never-persisted-in-cleartext',
      },
    });
    expect(registeredDevice.statusCode).toBe(201);
    const device = responseData<{ id: string }>(registeredDevice);
    const deactivatedDevice = await server.inject({
      method: 'DELETE', url: `/api/v1/notifications/devices/${device.id}`,
      headers: { authorization: `Bearer ${manager.accessToken}` },
    });
    expect(deactivatedDevice.statusCode).toBe(200);

    const receiptDao = app.get(TransactionReceiptDao);
    await receiptDao.create({
      transactionId: verificationOutcomeTransactionId,
      submittedByUserId: userId,
      proof: {
        objectKey: `private/transaction-receipts/${auditId}.pdf`,
        fileName: 'phase9-audit-proof.pdf',
        mimeType: ProofMimeType.PDF,
        sizeBytes: 128,
        sha256: createHash('sha256').update('phase9-audit-proof').digest('hex'),
      },
      audit: {
        actor: {
          identityType: 'BUSINESS_USER', subjectId: userId, role: 'MANAGER',
          businessId, branchId, membershipId, workAssignmentId,
        },
        sessionId: managerSession.rows[0].id, businessId, branchId,
      },
    });

    const exportFile = await pool.query<{ id: string; job_id: string }>(
      `SELECT file.id, file.job_id FROM report_files file
       JOIN report_generation_jobs job ON job.id = file.job_id
       WHERE job.business_id = $1 AND job.requested_by_user_id = $2
       ORDER BY file.created_at DESC LIMIT 1`,
      [businessId, userId],
    );
    expect(exportFile.rowCount).toBe(1);
    await app.get(ReportExportDao).recordDownload({
      fileId: exportFile.rows[0].id,
      jobId: exportFile.rows[0].job_id,
      userId,
      businessId,
      branchId,
      actor: {
        identityType: 'BUSINESS_USER', subjectId: userId, role: 'MANAGER',
        businessId, branchId, membershipId, workAssignmentId,
      },
      sessionId: managerSession.rows[0].id,
    });

    const newlyCovered = await pool.query<{
      action_type: string; event_count: string;
    }>(
      `SELECT action_type, COUNT(*)::text AS event_count
       FROM audit_logs
       WHERE action_type = ANY($1::varchar[])
       GROUP BY action_type ORDER BY action_type`,
      [[
        'TRANSACTION_SUBMITTED', 'TRANSACTION_PROOF_UPLOADED',
        'REPORT_EXPORT_REQUESTED', 'REPORT_EXPORT_DOWNLOADED',
        'NOTIFICATION_PREFERENCE_UPDATED', 'NOTIFICATION_DEVICE_REGISTERED',
        'NOTIFICATION_DEVICE_DEACTIVATED',
      ]],
    );
    expect(newlyCovered.rows.map((row) => row.action_type)).toEqual([
      'NOTIFICATION_DEVICE_DEACTIVATED',
      'NOTIFICATION_DEVICE_REGISTERED',
      'NOTIFICATION_PREFERENCE_UPDATED',
      'REPORT_EXPORT_DOWNLOADED',
      'REPORT_EXPORT_REQUESTED',
      'TRANSACTION_PROOF_UPLOADED',
      'TRANSACTION_SUBMITTED',
    ]);
    expect(newlyCovered.rows.every((row) => Number(row.event_count) >= 1)).toBe(true);

    const businessAudit = await server.inject({
      method: 'GET',
      url: `/api/v1/businesses/${businessId}/audit-logs?actionType=AUDIT_QUERY_TEST`,
      headers: { authorization: `Bearer ${manager.accessToken}` },
    });
    expect(businessAudit.statusCode).toBe(200);
    const businessData = responseData<{
      items: Array<{
        id: string; branchId: string; correlationId: string;
        newValue: { status: string };
      }>;
      total: number;
    }>(businessAudit);
    expect(businessData.total).toBe(1);
    expect(businessData.items[0]).toMatchObject({
      id: auditId, branchId, correlationId: 'phase9-audit-correlation',
      newValue: { status: 'ACTIVE' },
    });

    const override = await server.inject({
      method: 'GET',
      url: `/api/v1/businesses/${businessId}/audit-logs` +
        '?branchId=00000000-0000-4000-8000-000000000001',
      headers: { authorization: `Bearer ${manager.accessToken}` },
    });
    expect(override.statusCode).toBe(403);

    const adminLogin = await server.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: {
        identity: 'v2-admin@example.test',
        password: 'V2-Admin-Integration-Password!', devicePlatform: 'web',
      },
    });
    const admin = responseData<{ accessToken: string }>(adminLogin);
    const platformAudit = await server.inject({
      method: 'GET',
      url: `/api/v1/platform/audit-logs?businessId=${businessId}` +
        '&actionType=AUDIT_QUERY_TEST',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    expect(platformAudit.statusCode).toBe(200);
    expect(responseData<{ items: Array<{ id: string }> }>(platformAudit).items)
      .toEqual([expect.objectContaining({ id: auditId })]);
  });
});
