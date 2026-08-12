export const PUSH_NOTIFICATION_PORT = Symbol('PUSH_NOTIFICATION_PORT');

export type PushMessage = {
  recipientToken: string;
  title: string;
  message: string;
  data: Readonly<Record<string, string>>;
};

export interface PushNotificationPort {
  send(message: PushMessage): Promise<{ providerMessageId: string }>;
}

export class PushProviderNotConfiguredError extends Error {
  constructor() {
    super('Push notification provider is not configured');
  }
}

export class PushProviderError extends Error {
  constructor(public readonly code: string, public readonly retryable: boolean) {
    super(`Push provider request failed: ${code}`);
  }
}

export class UnconfiguredPushNotificationAdapter implements PushNotificationPort {
  send(message: PushMessage): Promise<{ providerMessageId: string }> {
    void message;
    return Promise.reject(new PushProviderNotConfiguredError());
  }
}
