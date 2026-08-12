import { Injectable } from '@nestjs/common';
import { VerifyEtCredentialService } from './verify-et-credential.service';

const MAX_STATUS_URL_LENGTH = 2_048;

@Injectable()
export class VerifyEtStatusUrlPolicyService {
  constructor(private readonly credentials: VerifyEtCredentialService) {}

  validate(returnedStatusUrl: string): string {
    if (
      returnedStatusUrl.length === 0 ||
      returnedStatusUrl.length > MAX_STATUS_URL_LENGTH
    ) {
      throw new Error('Verify.ET status URL is invalid');
    }

    const { baseUrl } = this.credentials.getEnabledConfig();
    let statusUrl: URL;
    try {
      statusUrl = new URL(returnedStatusUrl, baseUrl);
    } catch {
      throw new Error('Verify.ET status URL is invalid');
    }
    const providerOrigin = new URL(baseUrl).origin;
    if (
      statusUrl.protocol !== 'https:' ||
      statusUrl.origin !== providerOrigin ||
      statusUrl.username ||
      statusUrl.password ||
      statusUrl.hash ||
      statusUrl.href.length > MAX_STATUS_URL_LENGTH
    ) {
      throw new Error('Verify.ET status URL is not trusted');
    }
    return statusUrl.href;
  }
}
