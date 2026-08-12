const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;
const MAX_COLLECTION_ITEMS = 50;
const MAX_STRING_LENGTH = 2_000;
const MAX_SERIALIZED_LENGTH = 32_000;

const sensitiveKey = /(?:password|passphrase|secret|token|authorization|cookie|api[_-]?key|access[_-]?key|private[_-]?key|account[_-]?number|raw[_-]?(?:payload|document|file)|base64)/iu;
const bearerValue = /\b(?:bearer|basic)\s+[a-z0-9._~+/=-]+/giu;
const jwtValue = /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/gu;

export function sanitizeAuditMetadata(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!value) return null;
  const sanitized = sanitizeValue(value, 0) as Record<string, unknown>;
  if (JSON.stringify(sanitized).length <= MAX_SERIALIZED_LENGTH) return sanitized;
  return { metadataTruncated: true };
}

export function sanitizeAuditText(value: string | undefined): string | null {
  if (!value) return null;
  return value
    .replace(bearerValue, REDACTED)
    .replace(jwtValue, REDACTED)
    .slice(0, MAX_STRING_LENGTH);
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return '[MAX_DEPTH]';
  if (typeof value === 'string') return sanitizeAuditText(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_COLLECTION_ITEMS)
      .map((item) => sanitizeValue(item, depth + 1));
  }
  if (typeof value !== 'object') return `[${typeof value}]`;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, MAX_COLLECTION_ITEMS)
      .map(([key, item]) => [
        key.slice(0, 100),
        sensitiveKey.test(key) ? REDACTED : sanitizeValue(item, depth + 1),
      ]),
  );
}
