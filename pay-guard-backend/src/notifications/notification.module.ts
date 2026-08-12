import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationController } from './notification.controller';
import { NotificationDao } from './notification.dao';
import { NotificationService } from './notification.service';
import {
  PUSH_NOTIFICATION_PORT, UnconfiguredPushNotificationAdapter,
} from './push-notification.port';
import { NotificationDeviceDao } from './notification-device.dao';
import { NotificationTokenCryptoService } from './notification-token-crypto.service';
import { NotificationDeliveryDao } from './notification-delivery.dao';
import { NotificationDeliveryService } from './notification-delivery.service';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { FirebaseHttpV1Adapter } from './firebase-http-v1.adapter';
import { NotificationAudienceDao } from './notification-audience.dao';

@Module({
  imports: [AuthModule],
  controllers: [NotificationController],
  providers: [
    NotificationDao,
    NotificationService,
    NotificationDeviceDao,
    NotificationTokenCryptoService,
    NotificationDeliveryDao,
    NotificationDeliveryService,
    NotificationAudienceDao,
    {
      provide: PUSH_NOTIFICATION_PORT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => config.firebase.enabled
        ? new FirebaseHttpV1Adapter(config.firebase)
        : new UnconfiguredPushNotificationAdapter(),
    },
  ],
  exports: [NotificationDao, NotificationService, NotificationDeliveryService,
    NotificationAudienceDao, PUSH_NOTIFICATION_PORT],
})
export class NotificationModule {}
