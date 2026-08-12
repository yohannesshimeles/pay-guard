export const QR_BANK_CODES = [
  'CBE',
  'BOA',
  'TELEBIRR',
  'MPESA',
  'CBE_BIRR',
  'DASHEN',
  'AWASH',
  'SIINQEE',
  'KAAFI_EBIRR',
  'ZEMEN',
] as const;

export type QrBankCode = (typeof QR_BANK_CODES)[number];

export type QrPayloadParseStatus =
  | 'COMPLETE'
  | 'PARTIAL'
  | 'UNRECOGNIZED'
  | 'AMBIGUOUS'
  | 'UNSUPPORTED_BANK';

export type ParsedQrPayloadModel = {
  status: QrPayloadParseStatus;
  format?: 'URL' | 'KEY_VALUE';
  bankCode?: QrBankCode;
  reference?: string;
  amountEtb?: string;
  transactionDate?: string;
  transactionTime?: string;
  receiptUrl?: string;
  receiptToken?: string;
  phoneNumber?: string;
  accountSuffix?: string;
  directVerificationSupported?: boolean;
};
