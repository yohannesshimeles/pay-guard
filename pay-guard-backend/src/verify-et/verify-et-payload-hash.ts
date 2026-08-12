import { createHash } from 'node:crypto';

const DEFAULT_MAX_CANONICAL_BYTES = 1_048_576;

export function hashVerifyEtBytes(
  payload: Uint8Array,
  maxBytes = DEFAULT_MAX_CANONICAL_BYTES,
): string {
  if (payload.byteLength > maxBytes) {
    throw new Error('Verify.ET payload exceeds the hashing limit');
  }
  return createHash('sha256').update(payload).digest('hex');
}

export function hashVerifyEtPayload(
  payload: unknown,
  maxBytes = DEFAULT_MAX_CANONICAL_BYTES,
): string {
  const canonical = canonicalJson(payload);
  if (Buffer.byteLength(canonical, 'utf8') > maxBytes) {
    throw new Error('Verify.ET payload exceeds the hashing limit');
  }
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error('Verify.ET payload is not JSON');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('Verify.ET payload is not a plain JSON object');
    }
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => {
        if (record[key] === undefined) {
          throw new Error('Verify.ET payload contains undefined');
        }
        return `${JSON.stringify(key)}:${canonicalJson(record[key])}`;
      });
    return `{${entries.join(',')}}`;
  }
  throw new Error('Verify.ET payload is not JSON');
}
