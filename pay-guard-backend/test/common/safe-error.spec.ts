import { describeError } from '../../src/common/safe-error';

describe('safe error descriptor', () => {
  it('keeps only bounded error classification and code', () => {
    const error = Object.assign(
      new Error('password=private database payload'),
      { code: '28P01', detail: 'accountNumber=100000001' },
    );

    expect(describeError(error)).toEqual({ name: 'Error', code: '28P01' });
    expect(JSON.stringify(describeError(error))).not.toContain('private');
    expect(JSON.stringify(describeError(error))).not.toContain('100000001');
  });

  it('rejects unbounded attacker-controlled classification fields', () => {
    expect(describeError({ name: 'bad value with spaces', code: 'x'.repeat(40) }))
      .toEqual({ name: 'UnknownError' });
  });
});
