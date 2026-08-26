const REDACTED = '[REDACTED]';
const MAX_PUBLIC_TEXT_LENGTH = 2_000;

const bearerValue = /\b(?:bearer|basic)\s+[a-z0-9._~+/=-]+/giu;
const jwtValue = /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/gu;
const urlCredentials = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/giu;
const keyedSecret = /(["']?)(password|passphrase|secret|token|authorization|cookie|api[_-]?key|access[_-]?key|private[_-]?key|account[_-]?number|raw[_-]?(?:payload|document|file)|base64)\1(\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/giu;

export function sanitizeSensitiveText(value: string): string {
  return value
    .replace(urlCredentials, `$1${REDACTED}@`)
    .replace(bearerValue, REDACTED)
    .replace(jwtValue, REDACTED)
    .replace(keyedSecret, (
      _match, quote: string, key: string, separator: string,
    ) =>
      `${quote}${key}${quote}${separator}${REDACTED}`,
    )
    .slice(0, MAX_PUBLIC_TEXT_LENGTH);
}
