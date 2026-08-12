import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { NotificationDao } from './notification.dao';
import { RegisterNotificationDeviceDto, UpdateNotificationPreferenceDto } from './dto/notification.dto';
import { NotificationRecipient } from './notification.models';
import {
  NotificationDeviceDao, NotificationDeviceOwnershipConflictError,
} from './notification-device.dao';
import { NotificationTokenCryptoService } from './notification-token-crypto.service';

@Injectable()
export class NotificationService {
  constructor(
    private readonly notifications: NotificationDao,
    private readonly devices: NotificationDeviceDao,
    private readonly tokenCrypto: NotificationTokenCryptoService,
  ) {}

  list(actor: AuthenticatedPrincipal, limit: number, offset: number) {
    return this.notifications.list(recipientFor(actor), limit, offset);
  }

  async markRead(actor: AuthenticatedPrincipal, notificationId: string) {
    const notification = await this.notifications.markRead(
      recipientFor(actor), notificationId,
    );
    if (!notification) throw new NotFoundException('Notification not found');
    return notification;
  }

  preferences(actor: AuthenticatedPrincipal) {
    return this.notifications.preferences(recipientFor(actor));
  }

  updatePreference(
    actor: AuthenticatedPrincipal, input: UpdateNotificationPreferenceDto,
  ) {
    return this.notifications.upsertPreference(recipientFor(actor), input);
  }

  async registerDevice(actor: AuthenticatedPrincipal, input: RegisterNotificationDeviceDto) {
    const encrypted = this.tokenCrypto.encrypt(input.token);
    try {
      return await this.devices.register(recipientFor(actor), input.platform, encrypted);
    } catch (error) {
      if (error instanceof NotificationDeviceOwnershipConflictError) {
        throw new ConflictException('Notification device cannot be registered');
      }
      throw error;
    }
  }

  async deactivateDevice(actor: AuthenticatedPrincipal, deviceId: string) {
    const affected = await this.devices.deactivate(recipientFor(actor), deviceId);
    if (affected !== 1) throw new NotFoundException('Notification device not found');
    return { id: deviceId, active: false };
  }
}

export function recipientFor(actor: AuthenticatedPrincipal): NotificationRecipient {
  return actor.identityType === 'PLATFORM_ADMIN'
    ? { identityType: 'PLATFORM_ADMIN', id: actor.userId }
    : { identityType: 'BUSINESS_USER', id: actor.userId };
}
