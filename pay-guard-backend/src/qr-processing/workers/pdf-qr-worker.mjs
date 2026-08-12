import { parentPort } from 'node:worker_threads';
import { createRequire } from 'node:module';
import jsQR from 'jsqr';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// PDF.js loads the native canvas package through CommonJS. Reuse that same
// binding and explicitly align Path2D so paths created by PDF.js are accepted
// by the canvas context (ESM and CommonJS expose distinct native constructors).
const require = createRequire(import.meta.url);
const { createCanvas, Path2D } = require('@napi-rs/canvas');
globalThis.Path2D = Path2D;

const MAX_PAGES = 3;
const MAX_PIXELS_PER_PAGE = 16_000_000;
const MAX_CANDIDATES = 4;
const SCALE = 2;

function mask(pixels, width, height, location) {
  const points = [
    location.topLeftCorner,
    location.topRightCorner,
    location.bottomLeftCorner,
    location.bottomRightCorner,
  ];
  if (
    points.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
    )
  ) {
    throw new Error('INVALID_LOCATION');
  }
  const margin = 4;
  const left = Math.max(
    0,
    Math.floor(Math.min(...points.map((point) => point.x))) - margin,
  );
  const right = Math.min(
    width - 1,
    Math.ceil(Math.max(...points.map((point) => point.x))) + margin,
  );
  const top = Math.max(
    0,
    Math.floor(Math.min(...points.map((point) => point.y))) - margin,
  );
  const bottom = Math.min(
    height - 1,
    Math.ceil(Math.max(...points.map((point) => point.y))) + margin,
  );
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
      pixels[offset + 3] = 255;
    }
  }
}

function decodePage(pixels, width, height, remaining) {
  const candidates = [];
  const locations = new Set();
  for (let attempt = 0; attempt < remaining; attempt += 1) {
    const result = jsQR(pixels, width, height, {
      inversionAttempts: 'dontInvert',
    });
    const value = result?.data?.trim();
    if (!result || !value || value.length > 4096) break;
    candidates.push(value);
    if (!result.location) break;
    const signature = [
      result.location.topLeftCorner,
      result.location.topRightCorner,
      result.location.bottomLeftCorner,
      result.location.bottomRightCorner,
    ]
      .map((point) => `${Math.round(point.x)},${Math.round(point.y)}`)
      .join('|');
    if (locations.has(signature)) break;
    locations.add(signature);
    mask(pixels, width, height, result.location);
  }
  return candidates;
}

async function run(body) {
  const bytes = new Uint8Array(body);
  const loadingTask = getDocument({
    data: bytes,
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  let document;
  try {
    document = await loadingTask.promise;
    if (document.numPages < 1 || document.numPages > MAX_PAGES) {
      throw new Error('PAGE_LIMIT');
    }
    const candidates = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: SCALE });
        const width = Math.ceil(viewport.width);
        const height = Math.ceil(viewport.height);
        if (width < 1 || height < 1 || width * height > MAX_PIXELS_PER_PAGE) {
          throw new Error('PIXEL_LIMIT');
        }
        const canvas = createCanvas(width, height);
        const context = canvas.getContext('2d');
        await page.render({ canvasContext: context, viewport }).promise;
        const image = context.getImageData(0, 0, width, height);
        candidates.push(
          ...decodePage(
            image.data,
            width,
            height,
            MAX_CANDIDATES - candidates.length,
          ),
        );
      } finally {
        page.cleanup();
      }
      if (candidates.length >= MAX_CANDIDATES) break;
    }
    return candidates;
  } finally {
    if (document) await document.destroy();
    else await loadingTask.destroy();
  }
}

async function handle(message) {
  if (
    typeof message !== 'object' ||
    message === null ||
    typeof message.id !== 'string' ||
    !(message.body instanceof ArrayBuffer)
  ) {
    throw new Error('INVALID_REQUEST');
  }
  try {
    const candidates = await run(message.body);
    // Notify the parent only after document/page native resources are released.
    parentPort.postMessage({ id: message.id, ok: true, candidates });
  } catch (error) {
    const code =
      error instanceof Error && /^[A-Z_]+$/.test(error.message)
        ? error.message
        : 'PDF_REJECTED';
    parentPort.postMessage({ id: message.id, ok: false, code });
  }
}

let queue = Promise.resolve();
parentPort.postMessage({ type: 'ready' });
parentPort.on('message', (message) => {
  // Serialize native canvas work inside this bounded worker. Concurrent API
  // requests still queue without executing native PDF renderers concurrently.
  queue = queue.then(() => handle(message));
});
