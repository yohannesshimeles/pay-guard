const { performance } = require('node:perf_hooks');
const { Pool } = require('pg');
const { DaoTransaction } = require('../dist/database/central.dao');
const { FinancialReportDao } = require('../dist/reports/financial-report.dao');
const { OperationalReportDao } = require('../dist/reports/operational-report.dao');
const { toCsv } = require('../dist/reports/report-export.worker');

const databaseUrl = process.env.REPORT_LOAD_DATABASE_URL;
const ledgerRows = boundedInteger('REPORT_LOAD_LEDGER_ROWS', 250_000, 10_000, 2_000_000);
const operationalRows = boundedInteger(
  'REPORT_LOAD_OPERATIONAL_ROWS', 100_000, 10_000, 1_000_000,
);
const iterations = boundedInteger('REPORT_LOAD_ITERATIONS', 10, 5, 100);
const financialThresholdMs = boundedInteger(
  'REPORT_LOAD_FINANCIAL_P95_MS', 1_500, 100, 60_000,
);
const operationalThresholdMs = boundedInteger(
  'REPORT_LOAD_OPERATIONAL_P95_MS', 2_000, 100, 60_000,
);
const exportThresholdMs = boundedInteger(
  'REPORT_LOAD_EXPORT_P95_MS', 2_100, 100, 60_000,
);

if (!databaseUrl) throw new Error('REPORT_LOAD_DATABASE_URL is required');

async function main() {
  const pool = new Pool({ connectionString: databaseUrl, max: 1,
    application_name: 'payguard-phase9-report-load' });
  const client = await pool.connect();
  try {
    const identity = await client.query('SELECT current_database() AS name');
    const databaseName = identity.rows[0]?.name;
    if (typeof databaseName !== 'string' || !databaseName.endsWith('_test')) {
      throw new Error('Phase 9 report load testing requires a database ending in _test');
    }
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '60s'");
    const fixture = await requireFixture(client);
    await seedFinancial(client, fixture, ledgerRows);
    await seedOperational(client, fixture, operationalRows);
    await client.query('ANALYZE ledger_entries');
    await client.query('ANALYZE customer_transactions');
    await client.query('ANALYZE verification_attempts');

    const dao = new DaoTransaction(client);
    const financial = new FinancialReportDao(dao);
    const operational = new OperationalReportDao(dao);
    const scope = { businessId: fixture.business_id, branchId: fixture.branch_id };
    const range = { dateFrom: '2035-01-01', dateTo: '2035-12-31' };
    const financialCall = () => financial.summary(scope, {
      ...range, settlementAccountId: fixture.settlement_account_id,
    });
    const operationalCall = () => operational.businessSummary(scope, range);

    const financialResult = await financialCall();
    const operationalResult = await operationalCall();
    assertReconciliation(financialResult, operationalResult,
      ledgerRows, operationalRows);

    const financialTimes = await measure(iterations, financialCall);
    const operationalTimes = await measure(iterations, operationalCall);
    const exportTimes = await measure(iterations, async () => {
      const started = performance.now();
      const report = await financialCall();
      const csv = toCsv(report);
      if (!csv.startsWith('metric,value\r\n')) {
        throw new Error('Export output is invalid');
      }
      return performance.now() - started;
    }, true);

    const result = {
      database: databaseName,
      fixture: { ledgerRows, operationalRows, iterations },
      thresholdsMs: { financialP95: financialThresholdMs,
        operationalP95: operationalThresholdMs, exportP95: exportThresholdMs },
      measuredMs: { financialP95: percentile95(financialTimes),
        operationalP95: percentile95(operationalTimes),
        exportP95: percentile95(exportTimes) },
      reconciliation: { ledgerEntryCount: financialResult.entryCount,
        verificationAttemptCount: sumCounts(
          operationalResult.verification.statuses,
        ) },
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    assertThreshold('financial report', result.measuredMs.financialP95,
      financialThresholdMs);
    assertThreshold('operational report', result.measuredMs.operationalP95,
      operationalThresholdMs);
    assertThreshold('financial export', result.measuredMs.exportP95,
      exportThresholdMs);
  } finally {
    try { await client.query('ROLLBACK'); } finally {
      client.release();
      await pool.end();
    }
  }
}

async function requireFixture(client) {
  const result = await client.query(
    `SELECT transaction.business_id, transaction.branch_id,
            transaction.work_assignment_id, transaction.submitted_by_user_id,
            transaction.settlement_account_id, transaction.bank_id
     FROM customer_transactions transaction
     WHERE transaction.branch_id IS NOT NULL
     ORDER BY transaction.created_at LIMIT 1`,
  );
  if (!result.rows[0]) {
    throw new Error('Run the V2 integration suite first to create a safe load fixture');
  }
  return result.rows[0];
}

function seedFinancial(client, fixture, count) {
  return client.query(
    `INSERT INTO ledger_entries (
       business_id, branch_id, settlement_account_id, entry_type, direction,
       amount, running_balance, actual_transaction_at, source_record_type,
       source_record_id, created_by_user_id, work_assignment_id
     )
     SELECT $1, $2, $3,
            (ARRAY['VERIFIED_DEPOSIT','MANUAL_DEPOSIT','WITHDRAWAL',
                   'POSITIVE_CORRECTION','NEGATIVE_CORRECTION'])[(item % 5) + 1],
            CASE WHEN item % 5 IN (2,4) THEN 'DEBIT' ELSE 'CREDIT' END,
            10.00, 0.00,
            '2035-01-01'::timestamptz + ((item % 365) * interval '1 day'),
            'PHASE9_LOAD', gen_random_uuid(), $4, $5
     FROM generate_series(1, $6::integer) item`,
    [fixture.business_id, fixture.branch_id, fixture.settlement_account_id,
     fixture.submitted_by_user_id, fixture.work_assignment_id, count],
  );
}

async function seedOperational(client, fixture, count) {
  await client.query(
    `INSERT INTO customer_transactions (
       business_id, branch_id, work_assignment_id, submitted_by_user_id,
       settlement_account_id, bank_id, transaction_reference, amount,
       transaction_date, transaction_time, submission_method, current_status,
       created_at
     )
     SELECT $1, $2, $3, $4, $5, $6,
            'PHASE9-LOAD-' || item::text, 10.00,
            DATE '2035-01-01' + (item % 365), TIME '12:00:00',
            'MANUAL', 'PROCESSING',
            '2035-01-01'::timestamptz + ((item % 365) * interval '1 day')
     FROM generate_series(1, $7::integer) item`,
    [fixture.business_id, fixture.branch_id, fixture.work_assignment_id,
     fixture.submitted_by_user_id, fixture.settlement_account_id,
     fixture.bank_id, count],
  );
  await client.query(
    `INSERT INTO verification_attempts (
       transaction_id, business_id, attempt_type, attempt_number,
       provider_request_id, provider_status, result_status,
       requested_at, responded_at, response_time_ms, error_code,
       created_at, attempt_key
     )
     SELECT transaction.id, transaction.business_id, 'INITIAL', 1,
            CASE WHEN sequence % 3 = 0 THEN NULL
                 ELSE 'load-provider-' || transaction.id::text END,
            CASE WHEN sequence % 3 = 0 THEN NULL
                 WHEN sequence % 3 = 1 THEN 'PENDING' ELSE 'FAILED' END,
            CASE WHEN sequence % 3 = 0 THEN 'QUEUED'
                 WHEN sequence % 3 = 1 THEN 'PENDING' ELSE 'FAILED' END,
            CASE WHEN sequence % 3 = 0 THEN NULL ELSE transaction.created_at END,
            CASE WHEN sequence % 3 = 0 THEN NULL
                 ELSE transaction.created_at + interval '250 milliseconds' END,
            CASE WHEN sequence % 3 = 0 THEN NULL ELSE 250 END,
            CASE WHEN sequence % 3 = 2 THEN 'PROVIDER_REJECTED' ELSE NULL END,
            transaction.created_at, 'phase9:load:' || transaction.id::text
     FROM (
       SELECT transaction.*, row_number() OVER (ORDER BY transaction.id) AS sequence
       FROM customer_transactions transaction
       WHERE transaction.business_id = $1 AND transaction.branch_id = $2
         AND transaction.transaction_reference LIKE 'PHASE9-LOAD-%'
     ) transaction`,
    [fixture.business_id, fixture.branch_id],
  );
}

async function measure(iterationCount, operation, operationReturnsDuration = false) {
  const times = [];
  await operation();
  for (let iteration = 0; iteration < iterationCount; iteration += 1) {
    const started = performance.now();
    const value = await operation();
    times.push(operationReturnsDuration ? value : performance.now() - started);
  }
  return times;
}

function assertReconciliation(financial, operational, expectedLedger, expectedAttempts) {
  if (financial.entryCount !== expectedLedger) {
    throw new Error(`Financial reconciliation failed: ${financial.entryCount}`);
  }
  const categoryCount = financial.categories.reduce(
    (total, category) => total + category.entryCount, 0,
  );
  if (categoryCount !== expectedLedger) {
    throw new Error(`Financial category reconciliation failed: ${categoryCount}`);
  }
  const attemptCount = sumCounts(operational.verification.statuses);
  if (attemptCount !== expectedAttempts) {
    throw new Error(`Operational reconciliation failed: ${attemptCount}`);
  }
}

function sumCounts(items) {
  return items.reduce((total, item) => total + item.count, 0);
}

function percentile95(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return Number(sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(2));
}

function assertThreshold(label, measured, threshold) {
  if (measured > threshold) {
    throw new Error(`${label} p95 ${measured}ms exceeds ${threshold}ms threshold`);
  }
}

function boundedInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});
