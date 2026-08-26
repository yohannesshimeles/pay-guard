const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const repositoryRoot = path.resolve(process.cwd(), '..');
const workflowsDirectory = path.join(repositoryRoot, '.github', 'workflows');
const dependabotPath = path.join(repositoryRoot, '.github', 'dependabot.yml');
const trustedActionOwners = new Set(['actions', 'docker']);
const requiredDependabotEntries = new Map([
  ['npm', '/pay-guard-backend'],
  ['docker', '/pay-guard-backend'],
  ['github-actions', '/'],
]);
const dependabotCommitPrefixes = new Map([
  ['npm', 'deps(npm)'],
  ['docker', 'deps(docker)'],
  ['github-actions', 'deps(actions)'],
]);
const shaPattern = /^[a-f0-9]{40}$/u;
const digestPattern = /@sha256:[a-f0-9]{64}$/u;
const issues = [];
let actionCount = 0;
let serviceImageCount = 0;
let dependencyReviewCount = 0;
let containerContractCount = 0;

function workflowFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return workflowFiles(target);
    return /\.ya?ml$/u.test(entry.name) ? [target] : [];
  });
}

function validateActions(file, source) {
  source.split(/\r?\n/u).forEach((line, lineIndex) => {
    const match = line.match(
      /^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s+#\s*(\S+))?\s*$/u,
    );
    if (!match) return;
    const reference = match[1];
    if (reference.startsWith('./') || reference.startsWith('docker://')) return;
    actionCount += 1;
    const separator = reference.lastIndexOf('@');
    const action = separator >= 0 ? reference.slice(0, separator) : reference;
    const revision = separator >= 0 ? reference.slice(separator + 1) : '';
    const owner = action.split('/')[0];
    const location = `${path.relative(repositoryRoot, file)}:${lineIndex + 1}`;
    if (!trustedActionOwners.has(owner)) {
      issues.push(`${location}: action owner is not approved`);
    }
    if (!shaPattern.test(revision)) {
      issues.push(`${location}: action must use a full immutable commit SHA`);
    }
    if (!/^v\d+(?:\.\d+(?:\.\d+)?)?$/u.test(match[2] ?? '')) {
      issues.push(
        `${location}: pinned action requires a human-readable version comment`,
      );
    }
  });
}

function validateServiceImages(file, source) {
  let document;
  try {
    document = yaml.load(source);
  } catch {
    issues.push(
      `${path.relative(repositoryRoot, file)}: workflow is not valid YAML`,
    );
    return;
  }
  for (const [jobName, job] of Object.entries(document?.jobs ?? {})) {
    for (const [serviceName, service] of Object.entries(job?.services ?? {})) {
      serviceImageCount += 1;
      if (
        typeof service?.image !== 'string' ||
        !digestPattern.test(service.image)
      ) {
        issues.push(
          `${path.relative(repositoryRoot, file)}: jobs.${jobName}.services.${serviceName}.image must use a sha256 digest`,
        );
      }
    }
  }
  const dependencyReviewJob = document?.jobs?.['dependency-review'];
  if (dependencyReviewJob) {
    dependencyReviewCount += 1;
    if (!String(dependencyReviewJob.if ?? '').includes('pull_request')) {
      issues.push(
        `${path.relative(repositoryRoot, file)}: dependency-review job must be pull-request-only`,
      );
    }
    const dependencyReviewStep = dependencyReviewJob.steps?.find((step) =>
      String(step?.uses ?? '').startsWith('actions/dependency-review-action@'),
    );
    if (!dependencyReviewStep) {
      issues.push(
        `${path.relative(repositoryRoot, file)}: dependency-review action is required`,
      );
    } else if (
      dependencyReviewStep.with?.['fail-on-severity'] !== 'high' ||
      dependencyReviewStep.with?.['fail-on-scopes'] !== 'runtime' ||
      dependencyReviewStep.with?.['comment-summary-in-pr'] !== 'never'
    ) {
      issues.push(
        `${path.relative(repositoryRoot, file)}: dependency-review policy must reject high runtime vulnerabilities without PR writes`,
      );
    }
  }
  const containerJob = document?.jobs?.container;
  if (containerJob) {
    const contractSteps = (containerJob.steps ?? []).filter((step) =>
      String(step?.run ?? '').includes('phase10-container-contract.cjs'),
    );
    containerContractCount += contractSteps.length;
    if (
      contractSteps.length !== 1 ||
      !String(contractSteps[0]?.run ?? '').includes('payguard-backend:ci') ||
      !String(contractSteps[0]?.run ?? '').includes('payguard-worker:ci')
    ) {
      issues.push(
        `${path.relative(repositoryRoot, file)}: container job must validate both API and worker image contracts exactly once`,
      );
    }
    const attestationStep = (containerJob.steps ?? []).find((step) =>
      String(step?.name ?? '').includes('SBOM'),
    );
    const attestationCommand = String(attestationStep?.run ?? '');
    if (
      (attestationCommand.match(/docker scout sbom --format spdx/gu) ?? [])
        .length !== 2 ||
      (attestationCommand.match(/BUILDX_METADATA_PROVENANCE=max/gu) ?? [])
        .length !== 2 ||
      (attestationCommand.match(/--metadata-file/gu) ?? []).length !== 2 ||
      !attestationCommand.includes('local://payguard-backend:ci') ||
      !attestationCommand.includes('local://payguard-worker:ci')
    ) {
      issues.push(
        `${path.relative(repositoryRoot, file)}: container job must export SPDX and max-level provenance for both images`,
      );
    }
  }
}

function validateDependabot() {
  let document;
  try {
    document = yaml.load(fs.readFileSync(dependabotPath, 'utf8'));
  } catch {
    issues.push(
      '.github/dependabot.yml: configuration is missing or invalid YAML',
    );
    return;
  }
  if (document?.version !== 2 || !Array.isArray(document.updates)) {
    issues.push('.github/dependabot.yml: version 2 and updates are required');
    return;
  }
  const seen = new Set();
  for (const [index, update] of document.updates.entries()) {
    const ecosystem = update?.['package-ecosystem'];
    const location = `.github/dependabot.yml: updates[${index}]`;
    if (!requiredDependabotEntries.has(ecosystem)) {
      issues.push(`${location}: package ecosystem is not approved`);
      continue;
    }
    if (seen.has(ecosystem)) {
      issues.push(`${location}: package ecosystem is duplicated`);
    }
    seen.add(ecosystem);
    if (update.directory !== requiredDependabotEntries.get(ecosystem)) {
      issues.push(
        `${location}: directory does not match the protected manifest location`,
      );
    }
    if (
      update.schedule?.interval !== 'weekly' ||
      update.schedule?.day !== 'wednesday' ||
      update.schedule?.timezone !== 'Africa/Addis_Ababa' ||
      !/^\d{2}:\d{2}$/u.test(update.schedule?.time ?? '')
    ) {
      issues.push(
        `${location}: weekly Addis Ababa schedule with explicit time is required`,
      );
    }
    if (
      !Number.isInteger(update['open-pull-requests-limit']) ||
      update['open-pull-requests-limit'] < 1 ||
      update['open-pull-requests-limit'] > 10
    ) {
      issues.push(
        `${location}: open pull request limit must be between 1 and 10`,
      );
    }
    if ('target-branch' in update) {
      issues.push(
        `${location}: target-branch must remain unset for default-branch security updates`,
      );
    }
    if ('allow' in update || 'ignore' in update) {
      issues.push(
        `${location}: dependency allowlists and ignores are forbidden`,
      );
    }
    if (
      update['commit-message']?.prefix !==
      dependabotCommitPrefixes.get(ecosystem)
    ) {
      issues.push(`${location}: commit-message prefix is invalid`);
    }
    if (ecosystem === 'npm') {
      const groups = update.groups ?? {};
      for (const [group, dependencyType] of [
        ['production-minor-patch', 'production'],
        ['development-minor-patch', 'development'],
      ]) {
        const policy = groups[group];
        const updateTypes = [...(policy?.['update-types'] ?? [])].sort();
        if (
          policy?.['dependency-type'] !== dependencyType ||
          updateTypes.join(',') !== 'minor,patch'
        ) {
          issues.push(
            `${location}: npm ${group} policy must contain only minor and patch updates`,
          );
        }
      }
      if (Object.keys(groups).length !== 2) {
        issues.push(
          `${location}: npm must have exactly two reviewed update groups`,
        );
      }
    } else if ('groups' in update) {
      issues.push(
        `${location}: ${ecosystem} updates must remain individually reviewable`,
      );
    }
  }
  for (const ecosystem of requiredDependabotEntries.keys()) {
    if (!seen.has(ecosystem)) {
      issues.push(
        `.github/dependabot.yml: ${ecosystem} update policy is missing`,
      );
    }
  }
}

const files = workflowFiles(workflowsDirectory);
if (files.length === 0)
  issues.push('.github/workflows: no workflow files found');
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  validateActions(file, source);
  validateServiceImages(file, source);
}
validateDependabot();
if (actionCount === 0)
  issues.push('.github/workflows: no external actions found');
if (serviceImageCount === 0)
  issues.push('.github/workflows: no service images found');
if (dependencyReviewCount !== 1)
  issues.push(
    '.github/workflows: exactly one dependency-review job is required',
  );
if (containerContractCount !== 1)
  issues.push(
    '.github/workflows: exactly one API/worker container-contract gate is required',
  );

if (issues.length > 0) {
  console.error(
    `CI supply-chain validation failed (${issues.length} issue(s))`,
  );
  issues.forEach((issue) => console.error(`- ${issue}`));
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        workflows: files.length,
        actionsPinnedByCommit: actionCount,
        serviceImagesPinnedByDigest: serviceImageCount,
        dependencyReviewJobs: dependencyReviewCount,
        containerContractGates: containerContractCount,
        dependabotEcosystems: [...requiredDependabotEntries.keys()].sort(),
        trustedActionOwners: [...trustedActionOwners].sort(),
      },
      null,
      2,
    ),
  );
}
