export const NOTIFICATION_TYPES = [
  'FRAUD_ALERT',
  'CREDIT_ALERT',
  'INCIDENT_ALERT',
  'TRANSACTION_UPDATE',
  'DEVICE_EVENT',
  'FINANCIAL_EVENT',
  'RECONCILIATION_EVENT',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TEMPLATE_KEYS = [
  'SUBSCRIPTION_FRAUD_ALERT',
  'CREDIT_THRESHOLD_ALERT',
  'PROVIDER_INCIDENT_ALERT',
  'TRANSACTION_STATUS_UPDATE',
  'CREDIT_USAGE_THRESHOLD',
  'WAITER_DEVICE_SESSION',
  'FINANCIAL_OPERATION_EVENT',
  'RECONCILIATION_STATUS_EVENT',
] as const;

export type NotificationTemplateKey =
  (typeof NOTIFICATION_TEMPLATE_KEYS)[number];

export type NotificationRecipient =
  | { identityType: 'BUSINESS_USER'; id: string }
  | { identityType: 'PLATFORM_ADMIN'; id: string };

export type NotificationView = {
  id: string;
  title: string;
  message: string;
  notificationType: string;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
};

export type NotificationPreferenceView = {
  notificationType: string;
  inAppEnabled: boolean;
  pushEnabled: boolean;
};
