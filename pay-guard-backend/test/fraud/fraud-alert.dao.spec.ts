import { DaoTransaction } from '../../src/database/central.dao';
import { FraudAlertDao } from '../../src/fraud/fraud-alert.dao';
import { NotificationDao } from '../../src/notifications/notification.dao';

describe('FraudAlertDao', () => {
  it('emits the admin notification in the same transaction as the alert', async () => {
    const one = jest.fn().mockResolvedValue({ id: 'alert-id', severity: 'HIGH' });
    const broadcast = jest.fn().mockResolvedValue(1);
    const dao = new FraudAlertDao({
      createPlatformAdminFraudBroadcastWithin: broadcast,
    } as unknown as NotificationDao);
    const transaction = { one } as unknown as DaoTransaction;

    await expect(dao.createWithin(transaction, {
      verificationId: 'verification-id', fraudFlagId: 'flag-id',
      businessId: 'business-id', branchId: 'branch-id', orderId: 'order-id',
      attemptNumber: 2, threshold: 3, ruleWindowDays: 30,
      purchaseLocked: false,
    })).resolves.toEqual({ id: 'alert-id', severity: 'HIGH' });
    expect(broadcast).toHaveBeenCalledWith(transaction, {
      verificationId: 'verification-id', businessId: 'business-id',
      branchId: 'branch-id', attemptNumber: 2,
    });
  });
});
