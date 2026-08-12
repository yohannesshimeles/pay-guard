import { BranchCreditWalletEntity } from '../../src/verifications/entities/branch-credit-wallet.entity';

describe('BranchCreditWalletEntity', () => {
  const updatedAt = new Date('2026-08-06T12:00:00.000Z');

  it('accepts a non-negative balanced branch wallet', () => {
    const wallet = new BranchCreditWalletEntity({
      branchId: 'branch-id',
      businessId: 'business-id',
      purchasedCredits: 10,
      usedCredits: 3,
      expiredCredits: 2,
      availableCredits: 5,
      updatedAt,
    });

    expect(wallet).toMatchObject({ availableCredits: 5, usedCredits: 3 });
  });

  it('rejects negative, fractional and unsafe balances', () => {
    for (const availableCredits of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        () =>
          new BranchCreditWalletEntity({
            branchId: 'branch-id',
            businessId: 'business-id',
            purchasedCredits: availableCredits,
            usedCredits: 0,
            expiredCredits: 0,
            availableCredits,
            updatedAt,
          }),
      ).toThrow('invalid balance');
    }
  });

  it('rejects a wallet whose balance formula does not reconcile', () => {
    expect(
      () =>
        new BranchCreditWalletEntity({
          branchId: 'branch-id',
          businessId: 'business-id',
          purchasedCredits: 10,
          usedCredits: 2,
          expiredCredits: 1,
          availableCredits: 8,
          updatedAt,
        }),
    ).toThrow('balance invariant is violated');
  });
});
