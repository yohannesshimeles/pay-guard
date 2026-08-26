import { Injectable } from '@nestjs/common';
import { VerifyEtCredentialService } from './verify-et-credential.service';
import { VerifyEtErrorMapperService } from './verify-et-error-mapper.service';
import { VerifyEtProviderError } from './verify-et-provider.error';
import { VerifyEtStatusUrlPolicyService } from './verify-et-status-url-policy.service';

export const VERIFYET_PROVIDER_ADAPTER = Symbol('VERIFYET_PROVIDER_ADAPTER');

export type VerifyEtProviderRequest = Readonly<{
  idempotencyKey: string;
  verificationAttemptId: string;
  providerRequestId?: string;
  bankId: string;
  bankCode: string;
  transactionReference: string;
  amount: string;
  receiverAccountSuffix: string;
}>;

type ProviderResultBase = Readonly<{
  httpStatus: number;
  providerRequestId: string;
  providerStatus: string;
  requestedAt: Date;
  respondedAt: Date;
}>;

export type VerifyEtProviderResult =
  | (ProviderResultBase &
      Readonly<{
        result: 'PENDING';
        nextRecheckAt: Date;
      }>)
  | (ProviderResultBase &
      Readonly<{
        result: 'FAILED';
        errorCode?: string;
      }>)
  | (ProviderResultBase &
      Readonly<{
        result: 'VERIFIED';
        providerBankId: string;
        transactionReference: string;
        amount: string;
        receiverAccountSuffix: string;
        providerTransactionAt: Date;
      }>);

export interface VerifyEtProviderAdapter {
  verify(request: VerifyEtProviderRequest): Promise<VerifyEtProviderResult>;
}

type JsonRecord = Record<string, unknown>;

@Injectable()
export class HttpVerifyEtProviderAdapter implements VerifyEtProviderAdapter {
  constructor(
    private readonly credentials: VerifyEtCredentialService,
    private readonly errors: VerifyEtErrorMapperService,
    private readonly statusUrls: VerifyEtStatusUrlPolicyService,
  ) {}

  async verify(request: VerifyEtProviderRequest): Promise<VerifyEtProviderResult> {
    const config = this.credentials.getEnabledConfig();
    const requestedAt = new Date();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    let response: Response;
    try {
      const endpoint = request.providerRequestId
        ? new URL(`/api/verify/${encodeURIComponent(request.providerRequestId)}`, config.baseUrl)
        : new URL('/api/verify', config.baseUrl);
      if (!request.providerRequestId) {
        endpoint.searchParams.set('waitMs', String(config.waitMs));
      }
      response = await fetch(endpoint, {
        method: request.providerRequestId ? 'GET' : 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'x-api-key': config.apiKey,
          ...(!request.providerRequestId ? {
            'content-type': 'application/json',
            'idempotency-key': request.idempotencyKey,
            ...(config.webhookUrl ? { 'x-webhook-url': config.webhookUrl } : {}),
          } : {}),
        },
        body: request.providerRequestId
          ? undefined
          : JSON.stringify(this.requestBody(request, config.webhookUrl)),
      });
    } catch {
      throw this.errors.fromNetworkFailure();
    } finally {
      clearTimeout(timeout);
    }

    const respondedAt = new Date();
    if (!response.ok && response.status !== 202) {
      throw this.errors.fromHttpStatus(
        response.status,
        response.headers.get('retry-after'),
        respondedAt,
      );
    }
    const body = await this.readJson(response, config.maxResponseBytes);
    return this.normalizeResponse(request, response.status, body, {
      requestedAt,
      respondedAt,
      initialPollDelayMs: config.initialPollDelayMs,
      maxPollDelayMs: config.maxPollDelayMs,
    });
  }

  private requestBody(
    request: VerifyEtProviderRequest,
    webhookUrl?: string,
  ): JsonRecord {
    const bank = request.bankCode.toLowerCase().replace(/[^a-z0-9]/gu, '');
    const common: JsonRecord = { bank, ...(webhookUrl ? { webhookUrl } : {}) };
    if (bank === 'cbe' || bank === 'boa') {
      return {
        ...common,
        referenceNumber: request.transactionReference,
        accountSuffix: request.receiverAccountSuffix,
      };
    }
    if (bank === 'telebirr' || bank === 'mpesa') {
      return { ...common, transactionNumber: request.transactionReference };
    }
    if (bank === 'cbebirr') {
      return {
        ...common,
        receiptNumber: request.transactionReference,
        phoneNumber: request.receiverAccountSuffix,
      };
    }
    if (['dashen', 'awash', 'siinqee', 'kaafiebirr'].includes(bank)) {
      return { ...common, referenceNumber: request.transactionReference };
    }
    if (bank === 'zemen') {
      throw new VerifyEtProviderError('INVALID_PROVIDER_REQUEST', false, 422);
    }
    return {
      reference: request.transactionReference,
      suffix: request.receiverAccountSuffix,
      ...(webhookUrl ? { webhookUrl } : {}),
    };
  }

  private async readJson(response: Response, maximumBytes: number): Promise<JsonRecord> {
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
      throw new VerifyEtProviderError('UNEXPECTED_PROVIDER_RESPONSE', false, response.status);
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw new VerifyEtProviderError('UNEXPECTED_PROVIDER_RESPONSE', false, response.status);
    }
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > maximumBytes) {
        await reader.cancel();
        throw new VerifyEtProviderError('UNEXPECTED_PROVIDER_RESPONSE', false, response.status);
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (!isRecord(parsed)) throw new Error('response is not an object');
      return parsed;
    } catch {
      throw new VerifyEtProviderError('UNEXPECTED_PROVIDER_RESPONSE', false, response.status);
    }
  }

  private normalizeResponse(
    request: VerifyEtProviderRequest,
    httpStatus: number,
    body: JsonRecord,
    timing: {
      requestedAt: Date;
      respondedAt: Date;
      initialPollDelayMs: number;
      maxPollDelayMs: number;
    },
  ): VerifyEtProviderResult {
    const verification = recordAt(body, 'verification');
    const data = Array.isArray(body.data)
      ? (isRecord(body.data[0]) ? body.data[0] : {})
      : recordAt(body, 'data');
    const links = recordAt(body, 'links');
    const requestId = stringAt(body, 'requestId')
      ?? stringAt(verification, 'requestId')
      ?? stringAt(data, 'requestId');
    if (!requestId) {
      throw new VerifyEtProviderError('UNEXPECTED_PROVIDER_RESPONSE', false, httpStatus);
    }
    const statusUrl = stringAt(links, 'statusUrl') ?? stringAt(body, 'statusUrl');
    if (statusUrl) this.statusUrls.validate(statusUrl);
    const processingStatus = (
      stringAt(verification, 'processingStatus')
      ?? stringAt(data, 'processingStatus')
      ?? (httpStatus === 202 ? 'queued' : 'completed')
    ).toLowerCase();
    const providerStatus = (
      stringAt(verification, 'status')
      ?? stringAt(data, 'status')
      ?? processingStatus
    ).toUpperCase();
    const verified = booleanAt(verification, 'verified')
      ?? booleanAt(data, 'verified')
      ?? false;
    if (
      httpStatus === 202 ||
      ['queued', 'running'].includes(processingStatus) ||
      providerStatus === 'PENDING'
    ) {
      const requestedDelay = numberAt(links, 'pollAfterMs')
        ?? numberAt(body, 'estimatedWaitMs')
        ?? timing.initialPollDelayMs;
      const delayMs = Math.max(
        500,
        Math.min(Math.round(requestedDelay), timing.maxPollDelayMs),
      );
      return {
        result: 'PENDING',
        httpStatus,
        providerRequestId: requestId,
        providerStatus,
        requestedAt: timing.requestedAt,
        respondedAt: timing.respondedAt,
        nextRecheckAt: new Date(timing.respondedAt.getTime() + delayMs),
      };
    }
    if (!verified || providerStatus !== 'SUCCESS') {
      return {
        result: 'FAILED',
        httpStatus,
        providerRequestId: requestId,
        providerStatus,
        requestedAt: timing.requestedAt,
        respondedAt: timing.respondedAt,
        errorCode: `VERIFYET_${providerStatus.replace(/[^A-Z0-9]+/gu, '_')}`,
      };
    }

    const reference = stringAt(data, 'referenceNumber')
      ?? stringAt(data, 'transactionNumber')
      ?? stringAt(data, 'receiptNumber')
      ?? stringAt(data, 'reference');
    const amount = normalizeAmount(data.amount);
    const providerTransactionAt = parseDate(
      stringAt(data, 'timestamp') ?? stringAt(data, 'completedAt'),
    );
    const settlementMatch = recordAt(data, 'settlementAccountMatch');
    const receiver = stringAt(settlementMatch, 'matchedSettlementAccount')
      ?? stringAt(data, 'receiverAccount');
    if (!reference || !amount || !providerTransactionAt || !receiver) {
      throw new VerifyEtProviderError('UNEXPECTED_PROVIDER_RESPONSE', false, httpStatus);
    }
    return {
      result: 'VERIFIED',
      httpStatus,
      providerRequestId: requestId,
      providerStatus: 'VERIFIED',
      requestedAt: timing.requestedAt,
      respondedAt: timing.respondedAt,
      providerBankId: request.bankId,
      transactionReference: reference,
      amount,
      receiverAccountSuffix: receiverSuffix(receiver, request.receiverAccountSuffix.length),
      providerTransactionAt,
    };
  }
}

@Injectable()
export class UnconfiguredVerifyEtProviderAdapter implements VerifyEtProviderAdapter {
  verify(): Promise<VerifyEtProviderResult> {
    throw new Error('Verify.ET provider transport is not configured');
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordAt(value: JsonRecord, key: string): JsonRecord {
  return isRecord(value[key]) ? value[key] : {};
}

function stringAt(value: JsonRecord, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === 'string' && candidate.length > 0
    ? candidate
    : undefined;
}

function numberAt(value: JsonRecord, key: string): number | undefined {
  const candidate = value[key];
  return typeof candidate === 'number' && Number.isFinite(candidate)
    ? candidate
    : undefined;
}

function booleanAt(value: JsonRecord, key: string): boolean | undefined {
  return typeof value[key] === 'boolean' ? value[key] : undefined;
}

function normalizeAmount(value: unknown): string | undefined {
  if ((typeof value !== 'string' && typeof value !== 'number') || value === '') {
    return undefined;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric.toFixed(2) : undefined;
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp);
}

function receiverSuffix(value: string, length: number): string {
  return value.replace(/\D/gu, '').slice(-length);
}
