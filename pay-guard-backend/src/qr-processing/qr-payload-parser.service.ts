import { Injectable } from '@nestjs/common';
import {
  ParsedQrPayloadModel,
  QrBankCode,
} from './models/parsed-qr-payload.model';

type CanonicalField =
  | 'bank'
  | 'reference'
  | 'amount'
  | 'date'
  | 'time'
  | 'token'
  | 'phone'
  | 'accountSuffix';

type BankProfile = {
  code: QrBankCode;
  required: readonly CanonicalField[];
  directVerificationSupported: boolean;
};

const MAX_PAYLOAD_CHARACTERS = 4_096;
const MAX_URL_CHARACTERS = 2_048;

const aliases: Record<CanonicalField, readonly string[]> = {
  bank: ['bank', 'bankcode', 'institution'],
  reference: [
    'reference',
    'ref',
    'transactionreference',
    'transactionid',
    'transactionno',
    'txid',
    'receiptno',
  ],
  amount: ['amount', 'amt', 'total'],
  date: ['date', 'transactiondate'],
  time: ['time', 'transactiontime'],
  token: ['token', 'receipttoken'],
  phone: ['phone', 'phonenumber', 'wallet', 'walletnumber'],
  accountSuffix: [
    'accountsuffix',
    'accountlastdigits',
    'lastdigits',
  ],
};

const profiles: Record<QrBankCode, BankProfile> = {
  CBE: { code: 'CBE', required: ['reference', 'accountSuffix'], directVerificationSupported: true },
  BOA: { code: 'BOA', required: ['reference', 'accountSuffix'], directVerificationSupported: true },
  TELEBIRR: { code: 'TELEBIRR', required: ['reference', 'phone'], directVerificationSupported: true },
  MPESA: { code: 'MPESA', required: ['reference'], directVerificationSupported: true },
  CBE_BIRR: { code: 'CBE_BIRR', required: ['reference', 'phone'], directVerificationSupported: true },
  DASHEN: { code: 'DASHEN', required: ['reference'], directVerificationSupported: true },
  AWASH: { code: 'AWASH', required: ['reference'], directVerificationSupported: true },
  SIINQEE: { code: 'SIINQEE', required: ['reference'], directVerificationSupported: true },
  KAAFI_EBIRR: { code: 'KAAFI_EBIRR', required: ['reference'], directVerificationSupported: true },
  ZEMEN: { code: 'ZEMEN', required: [], directVerificationSupported: false },
};

const bankAliases: Record<string, QrBankCode> = {
  CBE: 'CBE',
  COMMERCIALBANKOFETHIOPIA: 'CBE',
  BOA: 'BOA',
  BANKOFABYSSINIA: 'BOA',
  TELEBIRR: 'TELEBIRR',
  MPESA: 'MPESA',
  CBEBIRR: 'CBE_BIRR',
  DASHEN: 'DASHEN',
  DASHENBANK: 'DASHEN',
  AWASH: 'AWASH',
  AWASHBANK: 'AWASH',
  SIINQEE: 'SIINQEE',
  SIINQEEBANK: 'SIINQEE',
  KAAFI: 'KAAFI_EBIRR',
  KAAFIEBIRR: 'KAAFI_EBIRR',
  ZEMEN: 'ZEMEN',
  ZEMENBANK: 'ZEMEN',
};

@Injectable()
export class QrPayloadParserService {
  parse(rawValue: string): ParsedQrPayloadModel {
    const payload = rawValue.trim();
    if (!payload || payload.length > MAX_PAYLOAD_CHARACTERS) {
      return { status: 'UNRECOGNIZED' };
    }

    const extracted = this.extract(payload);
    if (!extracted) return { status: 'UNRECOGNIZED' };

    const values = new Map<CanonicalField, string>();
    for (const field of Object.keys(aliases) as CanonicalField[]) {
      const candidates = extracted.entries
        .filter(([key]) => aliases[field].includes(this.normalizeKey(key)))
        .map(([, value]) => value.trim())
        .filter(Boolean);
      const unique = [...new Set(candidates)];
      if (unique.length > 1) {
        return { status: 'AMBIGUOUS', format: extracted.format };
      }
      if (unique[0]) values.set(field, unique[0]);
    }

    const bankCode = this.bankCode(values.get('bank'));
    const parsed: ParsedQrPayloadModel = {
      status: 'UNRECOGNIZED',
      format: extracted.format,
      bankCode,
      reference: this.reference(values.get('reference')),
      amountEtb: this.amount(values.get('amount')),
      transactionDate: this.date(values.get('date')),
      transactionTime: this.time(values.get('time')),
      receiptUrl: extracted.receiptUrl,
      receiptToken: this.token(values.get('token')),
      phoneNumber: this.phone(values.get('phone')),
      accountSuffix: this.accountSuffix(values.get('accountSuffix')),
      directVerificationSupported: bankCode
        ? profiles[bankCode].directVerificationSupported
        : undefined,
    };

    if (bankCode === 'ZEMEN') return { ...parsed, status: 'UNSUPPORTED_BANK' };
    const recognizedCount = Object.values(parsed).filter(
      (value) => value !== undefined,
    ).length;
    if (recognizedCount <= 2) return parsed;
    if (!bankCode) return { ...parsed, status: 'PARTIAL' };

    const complete = profiles[bankCode].required.every((field) => {
      if (field === 'bank') return bankCode !== undefined;
      const modelField: Partial<Record<CanonicalField, keyof ParsedQrPayloadModel>> = {
        reference: 'reference',
        amount: 'amountEtb',
        date: 'transactionDate',
        time: 'transactionTime',
        token: 'receiptToken',
        phone: 'phoneNumber',
        accountSuffix: 'accountSuffix',
      };
      const key = modelField[field];
      return key ? parsed[key] !== undefined : false;
    });
    return { ...parsed, status: complete ? 'COMPLETE' : 'PARTIAL' };
  }

  private extract(payload: string): {
    format: 'URL' | 'KEY_VALUE';
    entries: [string, string][];
    receiptUrl?: string;
  } | undefined {
    if (/^https?:\/\//iu.test(payload)) {
      if (payload.length > MAX_URL_CHARACTERS) return undefined;
      try {
        const url = new URL(payload);
        if (url.username || url.password) return undefined;
        return {
          format: 'URL',
          entries: [...url.searchParams.entries()],
          receiptUrl: url.toString(),
        };
      } catch {
        return undefined;
      }
    }

    const entries: [string, string][] = [];
    for (const segment of payload.split(/[&;\r\n]+/u)) {
      const separator = segment.search(/[=:]/u);
      if (separator <= 0) continue;
      entries.push([
        segment.slice(0, separator).trim(),
        segment.slice(separator + 1).trim(),
      ]);
    }
    return entries.length ? { format: 'KEY_VALUE', entries } : undefined;
  }

  private normalizeKey(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/gu, '');
  }

  private bankCode(value: string | undefined): QrBankCode | undefined {
    if (!value) return undefined;
    return bankAliases[value.toUpperCase().replace(/[^A-Z0-9]/gu, '')];
  }

  private reference(value: string | undefined): string | undefined {
    return value && /^[A-Za-z0-9._/-]{4,180}$/u.test(value)
      ? value
      : undefined;
  }

  private amount(value: string | undefined): string | undefined {
    const match = /^(\d{1,15})(?:\.(\d{1,2}))?$/u.exec(value ?? '');
    if (!match) return undefined;
    const whole = BigInt(match[1]);
    const fraction = (match[2] ?? '').padEnd(2, '0');
    if (whole === 0n && fraction === '00') return undefined;
    return `${whole.toString()}.${fraction}`;
  }

  private date(value: string | undefined): string | undefined {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value ?? '');
    if (!match) return undefined;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.valueOf()) &&
      date.toISOString().slice(0, 10) === value
      ? value
      : undefined;
  }

  private time(value: string | undefined): string | undefined {
    const match = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/u.exec(
      value ?? '',
    );
    return match ? value : undefined;
  }

  private token(value: string | undefined): string | undefined {
    return value && /^[A-Za-z0-9._~-]{4,512}$/u.test(value)
      ? value
      : undefined;
  }

  private phone(value: string | undefined): string | undefined {
    return value && /^\+?[1-9]\d{7,14}$/u.test(value) ? value : undefined;
  }

  private accountSuffix(value: string | undefined): string | undefined {
    return value && /^\d{4,12}$/u.test(value) ? value : undefined;
  }
}
