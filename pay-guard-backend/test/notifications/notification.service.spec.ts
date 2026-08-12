import { ConflictException, NotFoundException } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { NotificationDao } from '../../src/notifications/notification.dao';
import {
  NotificationDeviceDao, NotificationDeviceOwnershipConflictError,
} from '../../src/notifications/notification-device.dao';
import { NotificationTokenCryptoService } from '../../src/notifications/notification-token-crypto.service';
import {
  NotificationService, recipientFor,
} from '../../src/notifications/notification.service';

describe('NotificationService', () => {
  const list = jest.fn();
  const markRead = jest.fn();
  const preferences = jest.fn();
  const upsertPreference = jest.fn<Promise<unknown>, [unknown, unknown, unknown]>();
  const register = jest.fn<Promise<unknown>, [unknown, unknown, unknown, unknown]>();
  const deactivate = jest.fn();
  const encrypt = jest.fn();
  const service = new NotificationService({
    list, markRead, preferences, upsertPreference,
  } as unknown as NotificationDao, {
    register, deactivate,
  } as unknown as NotificationDeviceDao, {
    encrypt,
  } as unknown as NotificationTokenCryptoService);
  const businessUser: AuthenticatedPrincipal = {
    userId: 'user-id', sessionId: 'session-id', role: 'WAITER',
    businessIds: ['business-id'], identityType: 'BUSINESS_USER',
  };
  const platformAdmin: AuthenticatedPrincipal = {
    userId: 'admin-id', sessionId: 'admin-session',
    role: 'PLATFORM_SUPER_ADMIN', businessIds: [],
    identityType: 'PLATFORM_ADMIN',
  };

  beforeEach(() => jest.clearAllMocks());

  it('isolates business-user and platform-admin recipient namespaces', () => {
    expect(recipientFor(businessUser)).toEqual({
      identityType: 'BUSINESS_USER', id: 'user-id',
    });
    expect(recipientFor(platformAdmin)).toEqual({
      identityType: 'PLATFORM_ADMIN', id: 'admin-id',
    });
  });

  it('lists only through the authenticated recipient boundary', async () => {
    list.mockResolvedValue([{ id: 'notification-id' }]);
    await expect(service.list(platformAdmin, 20, 5))
      .resolves.toEqual([{ id: 'notification-id' }]);
    expect(list).toHaveBeenCalledWith(
      { identityType: 'PLATFORM_ADMIN', id: 'admin-id' }, 20, 5,
    );
  });

  it('does not reveal whether another recipient owns a notification', async () => {
    markRead.mockResolvedValue(undefined);
    await expect(service.markRead(businessUser, 'unknown-id'))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('persists an explicit channel preference for the current principal', async () => {
    upsertPreference.mockResolvedValue({
      notificationType: 'FRAUD_ALERT', inAppEnabled: true, pushEnabled: false,
    });
    await service.updatePreference(platformAdmin, {
      notificationType: 'FRAUD_ALERT', inAppEnabled: true, pushEnabled: false,
    });
    expect(upsertPreference).toHaveBeenCalledWith(
      { identityType: 'PLATFORM_ADMIN', id: 'admin-id' },
      { notificationType: 'FRAUD_ALERT', inAppEnabled: true, pushEnabled: false },
      expect.any(Object),
    );
    const preferenceAudit = upsertPreference.mock.calls[0][2] as {
      sessionId: string; actor: { identityType: string; subjectId: string };
    };
    expect(preferenceAudit).toMatchObject({
      sessionId: 'admin-session',
      actor: { identityType: 'PLATFORM_ADMIN', subjectId: 'admin-id' },
    });
  });

  it('encrypts a push token before handing it to persistence', async () => {
    encrypt.mockReturnValue({
      ciphertext: 'ciphertext', iv: 'iv', authTag: 'tag', fingerprint: 'hash',
    });
    register.mockResolvedValue({ id: 'device-id', platform: 'android' });
    await service.registerDevice(businessUser, {
      platform: 'android', token: 'a-device-token-that-is-long-enough',
    });
    expect(register).toHaveBeenCalledWith(
      { identityType: 'BUSINESS_USER', id: 'user-id' }, 'android',
      { ciphertext: 'ciphertext', iv: 'iv', authTag: 'tag', fingerprint: 'hash' },
      expect.any(Object),
    );
    const deviceAudit = register.mock.calls[0][3] as {
      sessionId: string; actor: { subjectId: string; role: string };
    };
    expect(deviceAudit).toMatchObject({
      sessionId: 'session-id',
      actor: { subjectId: 'user-id', role: 'WAITER' },
    });
  });

  it('does not disclose or reassign a token owned by another identity', async () => {
    encrypt.mockReturnValue({
      ciphertext: 'ciphertext', iv: 'iv', authTag: 'tag', fingerprint: 'hash',
    });
    register.mockRejectedValue(new NotificationDeviceOwnershipConflictError());
    await expect(service.registerDevice(businessUser, {
      platform: 'android', token: 'a-device-token-that-is-long-enough',
    })).rejects.toBeInstanceOf(ConflictException);
  });
});
