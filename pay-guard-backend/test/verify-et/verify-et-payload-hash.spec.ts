import { hashVerifyEtPayload } from '../../src/verify-et/verify-et-payload-hash';

describe('hashVerifyEtPayload', () => {
  it('produces the same SHA-256 hash for equivalent objects', () => {
    const first = hashVerifyEtPayload({
      amount: 125.5,
      nested: { b: 2, a: 1 },
    });
    const second = hashVerifyEtPayload({
      nested: { a: 1, b: 2 },
      amount: 125.5,
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('changes when the request payload changes', () => {
    expect(hashVerifyEtPayload({ amount: 125.5 })).not.toBe(
      hashVerifyEtPayload({ amount: 125.51 }),
    );
  });

  it.each([
    ['undefined property', { value: undefined }],
    ['non-finite number', { value: Number.POSITIVE_INFINITY }],
    ['non-plain object', { value: new Date() }],
    ['non-JSON primitive', Symbol('secret')],
  ])('rejects %s', (_label, payload) => {
    expect(() => hashVerifyEtPayload(payload)).toThrow(/Verify\.ET payload/u);
  });

  it('rejects a canonical payload above the configured byte limit', () => {
    expect(() => hashVerifyEtPayload({ value: 'oversized' }, 8)).toThrow(
      'Verify.ET payload exceeds the hashing limit',
    );
  });
});
