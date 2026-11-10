import { parentPort, workerData } from 'node:worker_threads';
import { MessagingError, type KernelCall } from '@notify-hub/contracts';
import type { MessageLimits } from '@notify-hub/store';
import { MessagingKernel } from '../../../packages/core/src/kernel.ts';

const port = parentPort!;
const { dbPath, adminToken, limits } = workerData as { dbPath: string; adminToken: string; limits?: Partial<MessageLimits> };
const kernel = new MessagingKernel(dbPath, adminToken, limits);
interface Request extends KernelCall { id: number }
const waiting = new Map<number, { request: Request; deadline: number; timer?: NodeJS.Timeout }>();
function error(id: number, cause: unknown): void {
  const err = cause instanceof MessagingError ? cause : new MessagingError('internal_error', '通信内核操作失败', 500);
  port.postMessage({ id, error: { code: err.code, message: err.message, status: err.status } });
}
function attempt(id: number): void {
  const waiter = waiting.get(id);
  if (!waiter) return;
  clearTimeout(waiter.timer);
  try {
    const result = kernel.execute('delivery.claim', waiter.request.token, waiter.request.input) as { batch: unknown; next_at?: number };
    if (result.batch || Date.now() >= waiter.deadline) {
      waiting.delete(id); port.postMessage({ id, result: { batch: result.batch } });
    } else {
      const due = Math.min(waiter.deadline, result.next_at ?? waiter.deadline);
      waiter.timer = setTimeout(() => attempt(id), Math.max(1, due - Date.now()));
    }
  } catch (cause) { waiting.delete(id); error(id, cause); }
}
function wake(targets?: string[]): void {
  for (const [id, waiter] of waiting) {
    const endpoint = (waiter.request.input as { endpoint?: string }).endpoint;
    if (!targets || (endpoint && targets.includes(endpoint))) attempt(id);
  }
}
port.on('message', (request: Request & { cancel?: number; close?: boolean }) => {
  if (request.cancel !== undefined) {
    clearTimeout(waiting.get(request.cancel)?.timer); waiting.delete(request.cancel); return;
  }
  if (request.close) {
    for (const waiter of waiting.values()) clearTimeout(waiter.timer);
    waiting.clear(); kernel.close(); port.close(); return;
  }
  try {
    if (request.operation === 'delivery.claim') {
      const input = request.input as { wait_ms?: number } | undefined;
      // Validation/authentication still run inside execute before trusting endpoint or wait values.
      const result = kernel.execute('delivery.claim', request.token, request.input) as { batch: unknown; next_at?: number };
      if (result.batch || !input?.wait_ms) { port.postMessage({ id: request.id, result: { batch: result.batch } }); return; }
      if (waiting.size >= 1024) throw new MessagingError('overloaded', '等待连接过多', 429);
      waiting.set(request.id, { request, deadline: Date.now() + input.wait_ms });
      attempt(request.id);
      return;
    }
    const result = kernel.execute(request.operation, request.token, request.input);
    port.postMessage({ id: request.id, result });
    if (request.operation === 'publish') wake((result as { recipients: string[] }).recipients);
    else if (request.operation === 'delivery.ack' || request.operation === 'delivery.renew' || request.operation.startsWith('endpoints.')) wake();
  } catch (cause) { error(request.id, cause); }
});
port.postMessage({ ready: true });
