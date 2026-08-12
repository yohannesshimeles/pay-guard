import {
  classifySubscriptionReuse,
} from '../../src/subscriptions/subscription-fraud.dao';

describe('subscription fraud classification', () => {
  it('classifies redeemed-proof reuse on the original date as a duplicate upload', () => {
    expect(classifySubscriptionReuse('2026-08-09', '2026-08-09')).toBe('SAME_DAY');
  });

  it('classifies reuse on a different transaction date as suspected fraud', () => {
    expect(classifySubscriptionReuse('2026-08-09', '2026-08-10'))
      .toBe('CROSS_DAY_FRAUD');
  });

  it('normalizes PostgreSQL Date objects before comparing calendar dates', () => {
    expect(classifySubscriptionReuse(
      new Date('2026-08-09T00:00:00.000Z'), '2026-08-09',
    )).toBe('SAME_DAY');
  });
});
