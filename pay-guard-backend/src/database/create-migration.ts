import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function migrationName(): string {
  const separator = process.argv.indexOf('--');
  const raw = (separator >= 0 ? process.argv[separator + 1] : process.argv[2]) ?? '';
  const name = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (name.length < 3) throw new Error('Provide a descriptive migration name');
  return name;
}

async function create(): Promise<void> {
  const name = migrationName();
  const version = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const directory = resolve(process.cwd(), 'migrations');
  await mkdir(directory, { recursive: true });
  const upPath = resolve(directory, `${version}_${name}.sql`);
  await writeFile(
    upPath,
    `-- ${name.replaceAll('_', ' ')}\n-- Forward-only by default; keep each change transactional.\n\n`,
    { encoding: 'utf8', flag: 'wx' },
  );
  process.stdout.write(`Created ${upPath}\n`);
  process.stdout.write(
    'Rollback is blocked by default. Add a reviewed matching .down.sql file only when rollback is safe.\n',
  );
}

void create().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Migration creation failed'}\n`);
  process.exitCode = 1;
});
