import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import { MessagingError, type MessagingErrorData, type MessagingService } from '@notify-hub/contracts';
import type { MessageLimits } from '@notify-hub/store';

/** The same asynchronous boundary is used in development and the bundled distribution. */
export class MessagingWorker implements MessagingService {
  private worker: Worker;
  private sequence = 0;
  private requests = new Map<number, { resolve(value: unknown): void; reject(error: unknown): void; cleanup(): void }>();
  private ready: Promise<void>;
  private closed = false;
  constructor(options: { dbPath: string; adminToken: string; limits?: Partial<MessageLimits> }) {
    const bundled = new URL('./messaging-worker.mjs', import.meta.url);
    const shared = new URL('../messaging-worker.mjs', import.meta.url);
    const entry = existsSync(bundled) ? bundled : existsSync(shared) ? shared : new URL('./messaging-worker-bootstrap.mjs', import.meta.url);
    this.worker = new Worker(entry, { workerData: options });
    this.ready = new Promise<void>((resolve, reject) => {
      this.worker.on('message', (message: { ready?: boolean; id: number; result?: unknown; error?: MessagingErrorData }) => {
        if (message.ready) { resolve(); return; }
        const pending = this.requests.get(message.id);
        if (!pending) return;
        this.requests.delete(message.id); pending.cleanup();
        if (message.error) pending.reject(new MessagingError(message.error.code, message.error.message, message.error.status));
        else pending.resolve(message.result);
      });
      const fail = (error: unknown) => {
        reject(error);
        for (const pending of this.requests.values()) { pending.cleanup(); pending.reject(error); }
        this.requests.clear(); this.closed = true;
      };
      this.worker.on('error', fail);
      this.worker.on('exit', code => fail(new MessagingError('unavailable', `通信内核已停止 (${code})`, 503)));
    });
    // Constructor startup failures are still observed by the first call or close.
    void this.ready.catch(() => {});
  }
  async call<T = unknown>(operation: string, token: string, input: unknown = {}, signal?: AbortSignal): Promise<T> {
    await this.ready;
    if (this.closed) throw new MessagingError('unavailable', '通信内核已停止', 503);
    if (signal?.aborted) throw signal.reason;
    if (this.requests.size >= 2048) throw new MessagingError('overloaded', '通信内核请求积压', 429);
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        this.requests.delete(id); this.worker.postMessage({ cancel: id }); reject(signal?.reason);
      };
      const cleanup = () => signal?.removeEventListener('abort', abort);
      this.requests.set(id, { resolve: result => resolve(result as T), reject, cleanup });
      signal?.addEventListener('abort', abort, { once: true });
      try { this.worker.postMessage({ id, operation, token, input }); }
      catch (err) { this.requests.delete(id); cleanup(); reject(err); }
    });
  }
  async close(): Promise<void> {
    if (this.closed) return;
    await this.ready;
    this.closed = true;
    const exited = new Promise<void>(resolve => this.worker.once('exit', () => resolve()));
    this.worker.postMessage({ close: true });
    await exited;
  }
}
