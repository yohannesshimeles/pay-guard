import { BadRequestException } from '@nestjs/common';
import { ProofFileValidator } from '../../src/qr-processing/proof-file.validator';
import {
  extractionStateFor,
  ProofMimeType,
  QrExtractionState,
} from '../../src/qr-processing/proof-file.types';

describe('ProofFileValidator', () => {
  const validator = new ProofFileValidator(32);

  it.each([
    ['receipt.jpg', 'image/jpeg', [0xff, 0xd8, 0xff, 0x01]],
    ['receipt.jpeg', 'image/jpeg', [0xff, 0xd8, 0xff, 0x02]],
    ['receipt.png', 'image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ['receipt.pdf', 'application/pdf', [...Buffer.from('%PDF-1.7')]],
  ])('accepts a valid %s proof', (fileName, mimeType, bytes) => {
    const result = validator.validate({
      fileName,
      mimeType,
      body: Uint8Array.from(bytes),
    });

    expect(result).toMatchObject({
      fileName,
      mimeType,
      sizeBytes: bytes.length,
    });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('rejects unsupported declared content types', () => {
    expect(() =>
      validator.validate({
        fileName: 'receipt.gif',
        mimeType: 'image/gif',
        body: Uint8Array.from([0x47, 0x49, 0x46]),
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects mismatched filename extensions', () => {
    expect(() =>
      validator.validate({
        fileName: 'receipt.pdf',
        mimeType: 'image/png',
        body: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      }),
    ).toThrow('Proof filename and content type do not match');
  });

  it('rejects content whose magic bytes do not match its declared type', () => {
    expect(() =>
      validator.validate({
        fileName: 'receipt.png',
        mimeType: 'image/png',
        body: Uint8Array.from(Buffer.from('%PDF-1.7')),
      }),
    ).toThrow('Proof content does not match its declared type');
  });

  it.each(['../receipt.pdf', '..\\receipt.pdf', 'bad\u0000name.pdf'])(
    'rejects unsafe filename %s',
    (fileName) => {
      expect(() =>
        validator.validate({
          fileName,
          mimeType: 'application/pdf',
          body: Uint8Array.from(Buffer.from('%PDF-1.7')),
        }),
      ).toThrow('Proof filename is invalid');
    },
  );

  it('rejects empty and oversized files', () => {
    expect(() =>
      validator.validate({
        fileName: 'receipt.pdf',
        mimeType: 'application/pdf',
        body: new Uint8Array(),
      }),
    ).toThrow('Proof file is empty');

    expect(() =>
      validator.validate({
        fileName: 'receipt.pdf',
        mimeType: 'application/pdf',
        body: Uint8Array.from(Buffer.from(`%PDF-${'a'.repeat(40)}`)),
      }),
    ).toThrow('Proof file exceeds the configured size limit');
  });
});

describe('extractionStateFor', () => {
  it('models zero, one and multiple QR outcomes without selecting a candidate', () => {
    expect(extractionStateFor([])).toBe(QrExtractionState.NO_QR);
    expect(extractionStateFor([{ rawValue: 'one' }])).toBe(
      QrExtractionState.SINGLE_QR,
    );
    expect(
      extractionStateFor([{ rawValue: 'one' }, { rawValue: 'two' }]),
    ).toBe(QrExtractionState.MULTIPLE_QR);
  });

  it('keeps enum values aligned with the receipt database constraint', () => {
    expect(Object.values(ProofMimeType)).toEqual([
      'image/jpeg',
      'image/png',
      'application/pdf',
    ]);
  });
});
