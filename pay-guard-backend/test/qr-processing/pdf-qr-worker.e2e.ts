import { PdfQrWorkerClient } from '../../src/qr-processing/pdf-qr-worker.client';
import {
  createMalformedPdf,
  createSyntheticQrPdf,
  SYNTHETIC_PDF_QR_PAYLOAD,
} from '../fixtures/synthetic-pdf-qr.fixture';

describe('PDF QR worker end-to-end', () => {
  const worker = new PdfQrWorkerClient();

  afterAll(async () => worker.onModuleDestroy());

  it('renders a real synthetic PDF and extracts its QR payload', async () => {
    const candidates = await worker.run(createSyntheticQrPdf());

    expect(candidates).toEqual([SYNTHETIC_PDF_QR_PAYLOAD]);
  }, 75_000);

  it('rejects a structurally malformed PDF', async () => {
    await expect(worker.run(createMalformedPdf())).rejects.toThrow(
      'PDF worker rejected input: PDF_REJECTED',
    );
  });

  it('rejects a document above the three-page limit before rendering', async () => {
    await expect(
      worker.run(createSyntheticQrPdf({ pageCount: 4 })),
    ).rejects.toThrow('PDF worker rejected input: PAGE_LIMIT');
  });

  it('rejects a page above the render-pixel limit before canvas allocation', async () => {
    await expect(
      worker.run(createSyntheticQrPdf({ pageSize: 3_000 })),
    ).rejects.toThrow('PDF worker rejected input: PIXEL_LIMIT');
  });
});
