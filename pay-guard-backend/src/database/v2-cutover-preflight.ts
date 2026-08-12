import {
  CutoverCheck,
  runDatabaseCutoverChecks,
  validateCutoverEnvironment,
} from './v2-cutover-checks';

async function main(): Promise<void> {
  const environmentChecks = validateCutoverEnvironment(process.env);
  const databaseUrl = process.env.DATABASE_URL;
  const databaseChecks = databaseUrl
    ? await runDatabaseCutoverChecks(databaseUrl)
    : [
        {
          name: 'Database preflight execution',
          status: 'FAIL' as const,
          detail: 'DATABASE_URL is missing',
        },
      ];
  const checks: CutoverCheck[] = [...environmentChecks, ...databaseChecks];

  for (const check of checks) {
    process.stdout.write(`[${check.status}] ${check.name}: ${check.detail}\n`);
  }
  const failures = checks.filter((check) => check.status === 'FAIL');
  if (failures.length) {
    process.stderr.write(
      `V2 cutover preflight: NO-GO (${failures.length} failed checks)\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write('V2 cutover preflight: AUTOMATED CHECKS PASSED\n');
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `V2 cutover preflight failed: ${
      error instanceof Error ? error.message : 'Unknown error'
    }\n`,
  );
  process.exitCode = 1;
});
