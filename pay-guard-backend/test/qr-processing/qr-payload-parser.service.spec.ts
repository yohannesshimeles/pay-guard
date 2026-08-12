import { QrPayloadParserService } from '../../src/qr-processing/qr-payload-parser.service';

describe('QrPayloadParserService', () => {
  const parser = new QrPayloadParserService();

  it.each([
    ['CBE', 'account_suffix=12345678'],
    ['BOA', 'account_suffix=12345'],
    ['Telebirr', 'phone=251911223344'],
    ['M-PESA', ''],
    ['CBE Birr', 'phone=251911223344'],
    ['Dashen', ''],
    ['Awash', 'token=synthetic-token'],
    ['Siinqee', 'token=synthetic-token'],
    ['Kaafi Ebirr', 'phone=251911223344'],
  ])('parses a complete synthetic %s payload', (bank, additional) => {
    const payload = [
      `bank=${bank}`,
      'reference=SYNTHETIC-REF-001',
      'amount=1250.5',
      'date=2026-08-05',
      'time=14:30:15',
      additional,
    ]
      .filter(Boolean)
      .join('&');

    expect(parser.parse(payload)).toMatchObject({
      status: 'COMPLETE',
      reference: 'SYNTHETIC-REF-001',
      amountEtb: '1250.50',
      transactionDate: '2026-08-05',
      transactionTime: '14:30:15',
      directVerificationSupported: true,
    });
  });

  it('marks Zemen as explicitly unsupported for direct verification', () => {
    expect(
      parser.parse('bank=Zemen&reference=SYNTHETIC-REF-002'),
    ).toMatchObject({
      status: 'UNSUPPORTED_BANK',
      bankCode: 'ZEMEN',
      directVerificationSupported: false,
    });
  });

  it('parses a safe HTTP receipt URL without fetching it', () => {
    const result = parser.parse(
      'https://receipt.example.test/view?bank=Awash&reference=SYNTHETIC-REF-003&token=synthetic-token',
    );
    expect(result).toMatchObject({
      status: 'COMPLETE',
      format: 'URL',
      bankCode: 'AWASH',
      reference: 'SYNTHETIC-REF-003',
      receiptToken: 'synthetic-token',
    });
    expect(result.receiptUrl).toContain('receipt.example.test');
  });

  it('rejects conflicting references instead of silently selecting one', () => {
    expect(
      parser.parse('bank=CBE&reference=REFERENCE-ONE&ref=REFERENCE-TWO'),
    ).toEqual({ status: 'AMBIGUOUS', format: 'KEY_VALUE' });
  });

  it.each([
    'javascript:alert(1)',
    'amount=-10&date=2026-02-30',
    'unstructured synthetic text',
  ])('does not treat malformed payload as complete: %s', (payload) => {
    expect(parser.parse(payload).status).not.toBe('COMPLETE');
  });
});
