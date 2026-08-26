const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const evidencePath = resolve(
  process.argv[2] ?? 'production-release-evidence.json',
);
let evidence;
try {
  evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
} catch {
  fail(['manifest: missing or invalid JSON']);
}

const errors = validateEvidence(evidence);
if (errors.length > 0) fail(errors);
process.stdout.write(
  JSON.stringify(
    {
      status: 'GO_EVIDENCE_COMPLETE',
      releaseId: evidence.release.id,
      environment: evidence.release.environment,
      evidenceItemsValidated: countLeaves(evidence),
    },
    null,
    2,
  ) + '\n',
);

function validateEvidence(value) {
  const issues = [];
  const requiredText = (path, input) => {
    if (
      typeof input !== 'string' ||
      input.trim().length < 3 ||
      /^(?:todo|tbd|unknown|placeholder|replace|example|n\/a)$/iu.test(
        input.trim(),
      )
    ) {
      issues.push(`${path}: required non-placeholder text`);
    }
  };
  const requiredUrl = (path, input, https = true) => {
    try {
      const url = new URL(input);
      if (https && url.protocol !== 'https:') throw new Error();
    } catch {
      issues.push(`${path}: required ${https ? 'HTTPS ' : ''}URL`);
    }
  };
  const requiredTime = (path, input) => {
    if (typeof input !== 'string' || Number.isNaN(Date.parse(input))) {
      issues.push(`${path}: required ISO timestamp`);
    }
  };
  const pass = (path, input) => {
    if (input !== 'PASS') issues.push(`${path}: must equal PASS`);
  };
  const requiredTrue = (path, input) => {
    if (input !== true) issues.push(`${path}: must equal true`);
  };
  const namedPair = (path, input) => {
    requiredText(`${path}.primary`, input?.primary);
    requiredText(`${path}.secondary`, input?.secondary);
    if (input?.primary === input?.secondary)
      issues.push(`${path}: owners must differ`);
    requiredUrl(
      `${path}.acknowledgementEvidence`,
      input?.acknowledgementEvidence,
    );
  };

  requiredText('release.id', value?.release?.id);
  if (!['staging', 'production'].includes(value?.release?.environment)) {
    issues.push('release.environment: must be staging or production');
  }
  requiredText('release.imageDigest', value?.release?.imageDigest);
  if (!/^sha256:[a-f0-9]{64}$/u.test(value?.release?.imageDigest ?? '')) {
    issues.push('release.imageDigest: required sha256 digest');
  }
  requiredTime('release.windowStart', value?.release?.windowStart);
  requiredTime('release.windowEnd', value?.release?.windowEnd);
  if (
    Date.parse(value?.release?.windowEnd) <=
    Date.parse(value?.release?.windowStart)
  ) {
    issues.push('release: windowEnd must follow windowStart');
  }

  for (const role of ['operator', 'approver', 'rollbackDecisionOwner']) {
    requiredText(`people.${role}`, value?.people?.[role]);
  }
  const people = [
    value?.people?.operator,
    value?.people?.approver,
    value?.people?.rollbackDecisionOwner,
  ];
  if (new Set(people).size !== people.length) {
    issues.push(
      'people: operator, approver and rollback owner must be distinct',
    );
  }

  pass('ci.status', value?.ci?.status);
  requiredUrl('ci.runEvidence', value?.ci?.runEvidence);
  requiredText('ci.commitSha', value?.ci?.commitSha);
  if (!/^[a-f0-9]{40}$/u.test(value?.ci?.commitSha ?? '')) {
    issues.push('ci.commitSha: required full 40-character commit SHA');
  }

  for (const setting of [
    'dependencyGraph',
    'dependabotAlerts',
    'dependabotSecurityUpdates',
  ]) {
    pass(
      `repositorySecurity.${setting}.status`,
      value?.repositorySecurity?.[setting]?.status,
    );
    requiredUrl(
      `repositorySecurity.${setting}.evidence`,
      value?.repositorySecurity?.[setting]?.evidence,
    );
  }
  const branchProtection = value?.repositorySecurity?.branchProtection;
  pass('repositorySecurity.branchProtection.status', branchProtection?.status);
  requiredUrl(
    'repositorySecurity.branchProtection.evidence',
    branchProtection?.evidence,
  );
  const requiredChecks = branchProtection?.requiredChecks;
  if (
    !Array.isArray(requiredChecks) ||
    new Set(requiredChecks).size !== requiredChecks.length ||
    !requiredChecks.every(
      (check) =>
        typeof check === 'string' &&
        /^[A-Za-z0-9][A-Za-z0-9._ /-]{1,99}$/u.test(check),
    )
  ) {
    issues.push(
      'repositorySecurity.branchProtection.requiredChecks: required unique check array',
    );
  } else {
    for (const check of ['dependency-review', 'validate', 'container']) {
      if (!requiredChecks.includes(check)) {
        issues.push(
          `repositorySecurity.branchProtection.requiredChecks: missing ${check}`,
        );
      }
    }
  }
  if (
    !Number.isInteger(branchProtection?.requiredApprovingReviews) ||
    branchProtection.requiredApprovingReviews < 1
  ) {
    issues.push(
      'repositorySecurity.branchProtection.requiredApprovingReviews: must be at least 1',
    );
  }
  for (const setting of [
    'dismissStaleApprovals',
    'requireConversationResolution',
    'blockForcePushes',
    'blockDeletions',
  ]) {
    requiredTrue(
      `repositorySecurity.branchProtection.${setting}`,
      branchProtection?.[setting],
    );
  }

  pass('infrastructure.tls.status', value?.infrastructure?.tls?.status);
  requiredUrl(
    'infrastructure.tls.evidence',
    value?.infrastructure?.tls?.evidence,
  );
  pass('infrastructure.waf.status', value?.infrastructure?.waf?.status);
  requiredUrl(
    'infrastructure.waf.evidence',
    value?.infrastructure?.waf?.evidence,
  );
  requiredText(
    'infrastructure.waf.approvedAuthPolicy',
    value?.infrastructure?.waf?.approvedAuthPolicy,
  );
  pass(
    'infrastructure.secretManager.status',
    value?.infrastructure?.secretManager?.status,
  );
  requiredUrl(
    'infrastructure.secretManager.evidence',
    value?.infrastructure?.secretManager?.evidence,
  );

  pass('verifyEt.status', value?.verifyEt?.status);
  requiredText('verifyEt.keyReference', value?.verifyEt?.keyReference);
  requiredText(
    'verifyEt.webhookSpecificationVersion',
    value?.verifyEt?.webhookSpecificationVersion,
  );
  requiredUrl('verifyEt.callbackUrl', value?.verifyEt?.callbackUrl);
  requiredUrl('verifyEt.drillEvidence', value?.verifyEt?.drillEvidence);

  pass('bankApprovals.status', value?.bankApprovals?.status);
  if (
    !Number.isInteger(value?.bankApprovals?.approvedReceivingAccounts) ||
    value.bankApprovals.approvedReceivingAccounts < 1
  ) {
    issues.push('bankApprovals.approvedReceivingAccounts: must be at least 1');
  }
  if (
    !Number.isInteger(value?.bankApprovals?.approvedQrSamples) ||
    value.bankApprovals.approvedQrSamples < 1
  ) {
    issues.push('bankApprovals.approvedQrSamples: must be at least 1');
  }
  requiredUrl('bankApprovals.evidence', value?.bankApprovals?.evidence);

  for (const drill of [
    'backupRestore',
    'archiveKeyRotation',
    'providerOutage',
    'queueReplay',
    'deploymentRollback',
  ]) {
    pass(`drills.${drill}.status`, value?.drills?.[drill]?.status);
    requiredUrl(`drills.${drill}.evidence`, value?.drills?.[drill]?.evidence);
    requiredTime(
      `drills.${drill}.exercisedAt`,
      value?.drills?.[drill]?.exercisedAt,
    );
  }
  for (const route of [
    'backend',
    'payments',
    'security',
    'platform',
    'productOperations',
  ]) {
    namedPair(`alertOwners.${route}`, value?.alertOwners?.[route]);
  }

  const serialized = JSON.stringify(value);
  if (
    /-----BEGIN .*PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{15,}\.|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\b(?:sk|rk)_live_/u.test(
      serialized,
    )
  ) {
    issues.push('manifest: secret material is forbidden');
  }
  if (containsAccountLikeNonUrl(value)) {
    issues.push('manifest: full account-like numbers are forbidden');
  }
  return issues;
}

function containsAccountLikeNonUrl(value) {
  if (typeof value === 'string') {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' || url.protocol === 'http:') return false;
    } catch {
      // Non-URL evidence text is checked below.
    }
    return /\b\d{8,24}\b/u.test(value);
  }
  if (Array.isArray(value)) return value.some(containsAccountLikeNonUrl);
  if (value && typeof value === 'object') {
    return Object.values(value).some(containsAccountLikeNonUrl);
  }
  return false;
}

function countLeaves(value) {
  if (value === null || typeof value !== 'object') return 1;
  return Object.values(value).reduce((sum, item) => sum + countLeaves(item), 0);
}

function fail(errors) {
  process.stderr.write(
    `Production release evidence: NO-GO (${errors.length} issue(s))\n`,
  );
  for (const error of errors) process.stderr.write(`- ${error}\n`);
  process.exit(1);
}
