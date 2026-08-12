const SYNTHETIC_QR_MATRIX = [
  '1111111001110111010001001111001111111',
  '1000001000011001000010101110001000001',
  '1011101001110010101001110001101011101',
  '1011101010110011010011111110101011101',
  '1011101010101111001111111101101011101',
  '1000001001100110100000000010001000001',
  '1111111010101010101010101010101111111',
  '0000000001001100000010000010000000000',
  '1100011101101011011000000101100011000',
  '1001010111100010010100111000000111100',
  '0100011000011000000000101001111011011',
  '1100110111110011100110011000111001011',
  '0101101100100110001110010010101001010',
  '0001010100001110000100011011000101000',
  '0100001000100111111000000001110100011',
  '0001000010101110101110001011100111100',
  '0001011100101011011000100101111010111',
  '0101100001000000100010111011000100010',
  '1001101110001110111111010111011101001',
  '0000110111010011101010100000110100010',
  '0100011101110000011010110101011010110',
  '1111110110101100100000011000000111000',
  '0111101000100111011010001001111100011',
  '0111110110001101101010000011011101000',
  '0110101001011101001110010011011101111',
  '1010000110100001000010110000110100010',
  '1011001111111001010010001111110010111',
  '1010110000110000101000110010111011101',
  '1000101011010001111110111111111111001',
  '0000000011101111011100010000100010010',
  '1111111011010001010101010111101011001',
  '1000001010101100100000100011100011011',
  '1011101001101010011110100111111111001',
  '1011101000100011100101110110111101111',
  '1011101001011001001010100011111100011',
  '1000001010110010001100010010001010001',
  '1111111011000110001110001000111011001',
] as const;

export const SYNTHETIC_PDF_QR_PAYLOAD =
  'provider=CBE&reference=PHASE3-PDF-0001&amount=125.50&currency=ETB&date=2026-08-06';

type SyntheticPdfOptions = {
  pageCount?: number;
  pageSize?: number;
};

export function createSyntheticQrPdf(
  options: SyntheticPdfOptions = {},
): Uint8Array {
  const moduleSize = 5;
  const quietZone = 4;
  const pageCount = options.pageCount ?? 1;
  const pageSize = options.pageSize ?? 300;
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error('Synthetic PDF page count must be a positive integer');
  }
  const qrSize = (SYNTHETIC_QR_MATRIX.length + quietZone * 2) * moduleSize;
  const origin = (pageSize - qrSize) / 2;
  const operations = [
    'q',
    '1 1 1 rg',
    `0 0 ${pageSize} ${pageSize} re f`,
    '0 0 0 rg',
  ];

  SYNTHETIC_QR_MATRIX.forEach((row, rowIndex) => {
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      if (row[columnIndex] !== '1') continue;
      const x = origin + (columnIndex + quietZone) * moduleSize;
      const y =
        origin +
        (SYNTHETIC_QR_MATRIX.length - 1 - rowIndex + quietZone) * moduleSize;
      operations.push(`${x} ${y} ${moduleSize} ${moduleSize} re f`);
    }
  });
  operations.push('Q');

  const stream = operations.join('\n');
  const firstPageObjectNumber = 3;
  const contentObjectNumber = firstPageObjectNumber + pageCount;
  const pageReferences = Array.from(
    { length: pageCount },
    (_, index) => `${firstPageObjectNumber + index} 0 R`,
  ).join(' ');
  const pageObjects = Array.from(
    { length: pageCount },
    () =>
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageSize} ${pageSize}] /Resources << >> /Contents ${contentObjectNumber} 0 R >>`,
  );
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageReferences}] /Count ${pageCount} >>`,
    ...pageObjects,
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'binary'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'binary');
  const xrefRows = offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xrefRows}` +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(pdf, 'binary'));
}

export function createMalformedPdf(): Uint8Array {
  return Uint8Array.from(Buffer.from('%PDF-1.7\nmalformed-without-objects'));
}
