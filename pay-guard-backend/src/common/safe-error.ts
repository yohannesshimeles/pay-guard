export type SafeErrorDescriptor = Readonly<{
  name: string;
  code?: string;
}>;

const safeName = /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/u;
const safeCode = /^[A-Za-z0-9_-]{1,32}$/u;

export function describeError(error: unknown): SafeErrorDescriptor {
  if (typeof error !== 'object' || error === null) {
    return { name: 'UnknownError' };
  }
  const candidate = error as { name?: unknown; code?: unknown };
  const name = typeof candidate.name === 'string' && safeName.test(candidate.name)
    ? candidate.name
    : 'UnknownError';
  const code = typeof candidate.code === 'string' && safeCode.test(candidate.code)
    ? candidate.code
    : undefined;
  return code ? { name, code } : { name };
}
