const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const rulePath = path.resolve(
  process.argv[2] ?? 'monitoring/payguard.rules.yml',
);
const expectedAlerts = new Set([
  'PayGuardRateLimitStoreErrors',
  'PayGuardRateLimitStoreBypass',
  'PayGuardRateLimitBlockedRatioHigh',
  'PayGuardVerifyEtProviderPaused',
  'PayGuardVerifyEtQueueNotDraining',
  'PayGuardVerifyEtWorkerTickFailure',
  'PayGuardReportExportWorkerTickFailure',
  'PayGuardReportExportFailed',
  'PayGuardArchiveWorkerTickFailure',
  'PayGuardNotificationWorkerTickFailure',
]);
const allowedMetrics = new Set([
  'payguard_rate_limit_decisions_total',
  'payguard_rate_limit_store_errors_total',
  'payguard_worker_results_total',
  'payguard_worker_tick_failures_total',
]);
const expectedOwnerRoles = new Set([
  'backend-on-call',
  'payments-on-call',
  'platform-on-call',
  'product-operations',
  'security-on-call',
]);
const forbiddenTerms =
  /account|business|delivery_id|email|phone|request_id|token|transaction|user/iu;

function fail(message) {
  throw new Error(`Alert rule validation failed: ${message}`);
}

function loadRules() {
  let document;
  try {
    document = yaml.load(fs.readFileSync(rulePath, 'utf8'));
  } catch {
    fail('rule file cannot be read as YAML');
  }
  if (
    !document ||
    !Array.isArray(document.groups) ||
    document.groups.length === 0
  ) {
    fail('groups must be a non-empty array');
  }
  return document.groups.flatMap((group, groupIndex) => {
    if (
      !group ||
      typeof group.name !== 'string' ||
      !Array.isArray(group.rules)
    ) {
      fail(`groups[${groupIndex}] is invalid`);
    }
    return group.rules;
  });
}

function validateRule(rule, index, names) {
  const location = `rules[${index}]`;
  if (
    !rule ||
    typeof rule.alert !== 'string' ||
    !expectedAlerts.has(rule.alert)
  ) {
    fail(`${location}.alert is not an approved alert`);
  }
  if (names.has(rule.alert)) fail(`${location}.alert is duplicated`);
  names.add(rule.alert);
  if (typeof rule.expr !== 'string' || rule.expr.trim().length === 0) {
    fail(`${location}.expr is required`);
  }
  const metrics = rule.expr.match(/payguard_[a-z_]+/gu) ?? [];
  if (
    metrics.length === 0 ||
    metrics.some((metric) => !allowedMetrics.has(metric))
  ) {
    fail(`${location}.expr uses an unapproved metric`);
  }
  if (forbiddenTerms.test(rule.expr)) {
    fail(
      `${location}.expr contains a forbidden high-cardinality or sensitive label`,
    );
  }
  const labels = rule.labels;
  if (!labels || !['critical', 'warning'].includes(labels.severity)) {
    fail(`${location}.labels.severity is invalid`);
  }
  for (const key of ['owner_primary_role', 'owner_secondary_role', 'runbook']) {
    if (typeof labels[key] !== 'string' || !/^[a-z0-9-]+$/u.test(labels[key])) {
      fail(`${location}.labels.${key} is invalid`);
    }
  }
  for (const key of ['owner_primary_role', 'owner_secondary_role']) {
    if (!expectedOwnerRoles.has(labels[key])) {
      fail(
        `${location}.labels.${key} is not an approved release-evidence role`,
      );
    }
  }
  if (labels.owner_primary_role === labels.owner_secondary_role) {
    fail(`${location} requires distinct primary and secondary roles`);
  }
  const annotations = rule.annotations;
  for (const key of ['summary', 'description']) {
    if (
      !annotations ||
      typeof annotations[key] !== 'string' ||
      annotations[key].length < 12
    ) {
      fail(`${location}.annotations.${key} is invalid`);
    }
    if (forbiddenTerms.test(annotations[key])) {
      fail(`${location}.annotations.${key} contains a forbidden term`);
    }
  }
}

const rules = loadRules();
const names = new Set();
rules.forEach((rule, index) => validateRule(rule, index, names));
const missing = [...expectedAlerts].filter((name) => !names.has(name));
if (missing.length > 0)
  fail(`required alert is missing: ${missing.join(', ')}`);
if (rules.length !== expectedAlerts.size)
  fail('unexpected additional alert rules are present');
const configuredOwnerRoles = new Set(
  rules.flatMap((rule) => [
    rule.labels.owner_primary_role,
    rule.labels.owner_secondary_role,
  ]),
);
const missingOwnerRoles = [...expectedOwnerRoles].filter(
  (role) => !configuredOwnerRoles.has(role),
);
if (missingOwnerRoles.length > 0) {
  fail(`required owner role is not routed: ${missingOwnerRoles.join(', ')}`);
}

console.log(
  JSON.stringify(
    {
      file: path.relative(process.cwd(), rulePath),
      runbooks: new Set(rules.map((rule) => rule.labels.runbook)).size,
      alerts: rules.length,
      metrics: [...allowedMetrics].sort(),
      ownerRoles: [...configuredOwnerRoles].sort(),
      status: 'PASS',
    },
    null,
    2,
  ),
);
