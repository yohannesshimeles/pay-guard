import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { Injectable, OnModuleDestroy } from '@nestjs/common';

const PDF_WORKER_STARTUP_TIMEOUT_MS = 60_000;
const PDF_WORKER_JOB_TIMEOUT_MS = 10_000;
const MAX_QR_CANDIDATES = 4;

type WorkerSuccess = { id: string; ok: true; candidates: string[] };
type WorkerFailure = { id: string; ok: false; code: string };
type PendingRequest = {
  resolve(candidates: string[]): void;
  reject(error: Error): void;
  timeout?: NodeJS.Timeout;
};

@Injectable()
export class PdfQrWorkerClient implements OnModuleDestroy {
  private worker?: Worker;
  private workerReady = false;
  private startupTimeout?: NodeJS.Timeout;
  private disabledError?: Error;
  private readonly pending = new Map<string, PendingRequest>();

  run(body: Uint8Array): Promise<string[]> {
    const worker = this.getWorker();
    const id = randomUUID();
    const transferable = new ArrayBuffer(body.byteLength);
    new Uint8Array(transferable).set(body);

    return new Promise((resolve, reject) => {
      const pending = { resolve, reject };
      this.pending.set(id, pending);
      if (this.workerReady) this.armJobTimeout(pending);
      try {
        worker.postMessage({ id, body: transferable }, [transferable]);
      } catch {
        this.disableWorker(new Error('PDF worker failed'));
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    const worker = this.worker;
    this.worker = undefined;
    this.workerReady = false;
    this.clearStartupTimeout();
    this.rejectPending(new Error('PDF worker stopped'));
    if (worker) {
      worker.unref();
      await worker.terminate().catch(() => undefined);
    }
  }

  private getWorker(): Worker {
    if (this.disabledError) throw this.disabledError;
    if (this.worker) return this.worker;

    const worker = new Worker(join(__dirname, 'workers', 'pdf-qr-worker.mjs'), {
      resourceLimits: {
        maxOldGenerationSizeMb: 256,
        maxYoungGenerationSizeMb: 32,
        stackSizeMb: 4,
      },
    });
    worker.unref();
    worker.on('message', (message: unknown) =>
      this.handleMessage(worker, message),
    );
    worker.once('error', () => {
      if (this.worker === worker) {
        this.disableWorker(new Error('PDF worker failed'));
      }
    });
    worker.once('exit', (code) => {
      if (this.worker === worker) {
        this.worker = undefined;
        this.workerReady = false;
        this.clearStartupTimeout();
        if (code !== 0 || this.pending.size > 0) {
          this.disabledError = new Error('PDF worker exited');
          this.rejectPending(this.disabledError);
        }
      }
    });
    this.worker = worker;
    this.startupTimeout = setTimeout(() => {
      this.disableWorker(new Error('PDF worker startup timed out'));
    }, PDF_WORKER_STARTUP_TIMEOUT_MS);
    return worker;
  }

  private handleMessage(worker: Worker, message: unknown): void {
    if (this.worker !== worker) return;
    if (this.isReadyMessage(message)) {
      if (this.workerReady) {
        this.disableWorker(new Error('Invalid PDF worker response'));
        return;
      }
      this.workerReady = true;
      this.clearStartupTimeout();
      for (const pending of this.pending.values()) {
        this.armJobTimeout(pending);
      }
      return;
    }
    if (!this.isWorkerMessage(message)) {
      this.disableWorker(new Error('Invalid PDF worker response'));
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      this.disableWorker(new Error('Invalid PDF worker response'));
      return;
    }
    this.pending.delete(message.id);
    if (pending.timeout) clearTimeout(pending.timeout);

    if (!message.ok) {
      pending.reject(new Error(`PDF worker rejected input: ${message.code}`));
      return;
    }
    if (
      message.candidates.length > MAX_QR_CANDIDATES ||
      message.candidates.some((value) => !value.trim() || value.length > 4_096)
    ) {
      this.disableWorker(new Error('Invalid PDF worker candidates'));
      return;
    }
    pending.resolve(message.candidates);
  }

  private disableWorker(error: Error): void {
    if (this.disabledError) return;
    this.disabledError = error;
    const worker = this.worker;
    this.worker = undefined;
    this.workerReady = false;
    this.clearStartupTimeout();
    this.rejectPending(error);
    if (worker) {
      worker.unref();
      void worker.terminate();
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private armJobTimeout(pending: PendingRequest): void {
    if (pending.timeout) return;
    pending.timeout = setTimeout(() => {
      this.disableWorker(new Error('PDF worker timed out'));
    }, PDF_WORKER_JOB_TIMEOUT_MS);
  }

  private clearStartupTimeout(): void {
    if (this.startupTimeout) clearTimeout(this.startupTimeout);
    this.startupTimeout = undefined;
  }

  private isReadyMessage(message: unknown): boolean {
    return (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === 'ready'
    );
  }

  private isWorkerMessage(
    message: unknown,
  ): message is WorkerSuccess | WorkerFailure {
    if (
      typeof message !== 'object' ||
      message === null ||
      !('id' in message) ||
      typeof message.id !== 'string' ||
      !('ok' in message)
    ) {
      return false;
    }
    if (message.ok === false) {
      return 'code' in message && typeof message.code === 'string';
    }
    return (
      message.ok === true &&
      'candidates' in message &&
      Array.isArray(message.candidates) &&
      message.candidates.every((value: unknown) => typeof value === 'string')
    );
  }
}
