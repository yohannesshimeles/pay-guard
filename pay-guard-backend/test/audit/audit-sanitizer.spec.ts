import { sanitizeAuditMetadata, sanitizeAuditText } from '../../src/audit/audit-sanitizer';

describe('audit sanitizer', () => {
  it('redacts sensitive keys recursively while preserving decision metadata', () => {
    expect(sanitizeAuditMetadata({
      status: 'ACTIVE',
      nested: { password: 'do-not-store', accountNumber: '10000001' },
      tokenHistory: ['also-secret'],
    })).toEqual({
      status: 'ACTIVE',
      nested: { password: '[REDACTED]', accountNumber: '[REDACTED]' },
      tokenHistory: '[REDACTED]',
    });
  });

  it('removes bearer credentials and JWT-shaped values from free text', () => {
    expect(sanitizeAuditText(
      'Denied Bearer abc.def-123 and eyJheader.eyJpayload.eyJsignature',
    )).toBe('Denied [REDACTED] and [REDACTED]');
  });

  it('bounds individual metadata strings', () => {
    expect(sanitizeAuditMetadata({ value: 'x'.repeat(40_000) }))
      .toEqual({ value: 'x'.repeat(2_000) });
  });
});
