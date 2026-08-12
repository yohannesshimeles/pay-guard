import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { VerifyEtProviderError } from './verify-et-provider.error';

export type EnabledVerifyEtConfig = Readonly<{
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maxResponseBytes: number;
  maxPollAttempts: number;
  initialPollDelayMs: number;
  maxPollDelayMs: number;
}>;

@Injectable()
export class VerifyEtCredentialService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  getEnabledConfig(): EnabledVerifyEtConfig {
    const provider = this.config.verifyEt;
    if (!provider.enabled || !provider.baseUrl || !provider.apiKey) {
      throw new VerifyEtProviderError('PROVIDER_DISABLED', false);
    }
    return Object.freeze({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      timeoutMs: provider.timeoutMs,
      maxResponseBytes: provider.maxResponseBytes,
      maxPollAttempts: provider.maxPollAttempts,
      initialPollDelayMs: provider.initialPollDelayMs,
      maxPollDelayMs: provider.maxPollDelayMs,
    });
  }
}
