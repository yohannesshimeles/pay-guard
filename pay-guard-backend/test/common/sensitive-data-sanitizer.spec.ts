import { sanitizeSensitiveText } from '../../src/common/sensitive-data-sanitizer';

describe('sensitive data sanitizer', () => {
  it('redacts authorization values, JWTs and URL credentials', () => {
    const value = [
      'Bearer private-access-token',
      'eyJheader.eyJpayload.eyJsignature',
      'postgresql://payguard:database-password@db.internal/payguard',
    ].join(' ');

    const result = sanitizeSensitiveText(value);

    expect(result).not.toContain('private-access-token');
    expect(result).not.toContain('eyJpayload');
    expect(result).not.toContain('database-password');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts keyed secrets, account numbers and raw payloads', () => {
    const result = sanitizeSensitiveText(
      'password=private accountNumber: 100000001 "rawPayload":"provider-body"',
    );

    expect(result).toBe(
      'password=[REDACTED] accountNumber: [REDACTED] "rawPayload":[REDACTED]',
    );
  });

  it('bounds public text', () => {
    expect(sanitizeSensitiveText('x'.repeat(4_000))).toHaveLength(2_000);
  });
});
