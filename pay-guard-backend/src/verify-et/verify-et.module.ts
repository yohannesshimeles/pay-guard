import { Module } from '@nestjs/common';
import { VerificationsModule } from '../verifications/verifications.module';
import { AuthModule } from '../auth/auth.module';
import { VerifyEtCredentialService } from './verify-et-credential.service';
import { VerifyEtErrorMapperService } from './verify-et-error-mapper.service';
import { VerifyEtRequestHistoryDao } from './verify-et-request-history.dao';
import { VerifyEtPollingPolicyService } from './verify-et-polling-policy.service';
import { VerifyEtStatusUrlPolicyService } from './verify-et-status-url-policy.service';
import { VerifyEtWebhookDeliveryDao } from './verify-et-webhook-delivery.dao';
import { VerifyEtWebhookIntakeService } from './verify-et-webhook-intake.service';
import {
  UnconfiguredVerifyEtWebhookSignatureVerifier,
  VERIFYET_WEBHOOK_SIGNATURE_VERIFIER,
} from './verify-et-webhook-signature-verifier';
import {
  UnconfiguredVerifyEtProviderAdapter,
  VERIFYET_PROVIDER_ADAPTER,
} from './verify-et-provider.adapter';
import { VerifyEtWorkItemDao } from './verify-et-work-item.dao';
import { VerifyEtWorkerService } from './verify-et-worker.service';
import { VerifyEtOperationalAlertDao } from './verify-et-operational-alert.dao';
import { VerifyEtIncidentController } from './verify-et-incident.controller';
import { VerifyEtIncidentDao } from './verify-et-incident.dao';
import { VerifyEtIncidentService } from './verify-et-incident.service';
import { NotificationModule } from '../notifications/notification.module';

@Module({
  imports: [AuthModule, VerificationsModule, NotificationModule],
  controllers: [VerifyEtIncidentController],
  providers: [
    VerifyEtCredentialService,
    VerifyEtErrorMapperService,
    VerifyEtRequestHistoryDao,
    VerifyEtPollingPolicyService,
    VerifyEtStatusUrlPolicyService,
    VerifyEtWebhookDeliveryDao,
    VerifyEtWebhookIntakeService,
    VerifyEtWorkItemDao,
    VerifyEtWorkerService,
    VerifyEtOperationalAlertDao,
    VerifyEtIncidentDao,
    VerifyEtIncidentService,
    {
      provide: VERIFYET_WEBHOOK_SIGNATURE_VERIFIER,
      useClass: UnconfiguredVerifyEtWebhookSignatureVerifier,
    },
    {
      provide: VERIFYET_PROVIDER_ADAPTER,
      useClass: UnconfiguredVerifyEtProviderAdapter,
    },
  ],
  exports: [
    VerifyEtCredentialService,
    VerifyEtErrorMapperService,
    VerifyEtRequestHistoryDao,
    VerifyEtPollingPolicyService,
    VerifyEtStatusUrlPolicyService,
    VerifyEtWebhookDeliveryDao,
    VerifyEtWebhookIntakeService,
    VerifyEtWorkItemDao,
    VerifyEtWorkerService,
    VerifyEtOperationalAlertDao,
    VerifyEtIncidentDao,
    VerifyEtIncidentService,
    VERIFYET_PROVIDER_ADAPTER,
    VERIFYET_WEBHOOK_SIGNATURE_VERIFIER,
  ],
})
export class VerifyEtModule {}
