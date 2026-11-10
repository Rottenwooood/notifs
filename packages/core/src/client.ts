import { randomUUID } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';
import { MessagingError, type MessageInput, type PublishOptions, type PublishResult } from '@notify-hub/contracts';
import { FrameDecoder, encodeFrame } from './framing.ts';

const routes: Record<string, [string, string]> = {
  authenticate: ['POST', '/api/authenticate'],
  'identities.create': ['POST', '/api/identities'],
  'identities.list': ['GET', '/api/identities'],
  'identities.rotate': ['POST', '/api/identities/rotate'],
  'identities.enable': ['POST', '/api/identities/enable'],
  'endpoints.put': ['PUT', '/api/endpoints'], 'endpoints.list': ['GET', '/api/endpoints'],
  'endpoints.resume': ['POST', '/api/endpoints/resume'],
  'subscriptions.put': ['PUT', '/api/subscriptions'], 'subscriptions.list': ['GET', '/api/subscriptions'],
  'maintenance.prune': ['POST', '/api/maintenance/prune'],
  status: ['GET', '/api/status'],
};
/** Publishing and management client; delivery is driven by the hub. */
export class MessageClient {
  private socket?: Socket;
  private connected?: Promise<void>;
  private authentication?: unknown;
  private pending = new Map<string, { resolve(value: unknown): void; reject(reason: unknown): void; timer: NodeJS.Timeout }>();
  constructor(private options: { token: string; baseUrl?: string; socketPath?: string }) {}
  private async connect(): Promise<void> {
    if (this.connected) return this.connected;
    this.connected = new Promise<void>((resolve, reject) => {
      const socket = this.socket = createConnection(this.options.socketPath!);
      const decoder = new FrameDecoder();
      const fail = (error: unknown) => {
        if (this.socket !== socket) return;
        this.socket = undefined; this.connected = undefined; this.authentication = undefined; reject(error);
        for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
        this.pending.clear();
      };
      socket.on('error', fail);
      socket.on('close', () => fail(new MessagingError('disconnected', 'IPC 连接已断开', 503)));
      socket.on('data', chunk => {
        try {
          decoder.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk, value => {
            const response = value as { id: string; result: unknown; error?: { code: string; message: string; status: number } };
            const pending = this.pending.get(response.id);
            if (!pending) return;
            clearTimeout(pending.timer); this.pending.delete(response.id);
            if (response.error) pending.reject(new MessagingError(response.error.code, response.error.message, response.error.status));
            else pending.resolve(response.result);
          });
        } catch (err) { fail(err); socket.destroy(); }
      });
      socket.once('connect', () => {
        void this.frame('authenticate', {}, this.options.token).then(result => { this.authentication = result; resolve(); }, err => { reject(err); socket.destroy(); });
      });
    });
    return this.connected;
  }
  private frame(operation: string, input: unknown, token?: string): Promise<unknown> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new MessagingError('timeout', 'IPC 请求超时，结果未知', 504)); }, 40_000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        if (!this.socket || this.socket.destroyed || this.socket.writableLength > 2_097_152) throw new MessagingError('overloaded', 'IPC 连接不可写', 429);
        this.socket.write(encodeFrame({ id, operation, input, ...(token ? { token } : {}) }));
      } catch (err) { clearTimeout(timer); this.pending.delete(id); reject(err); }
    });
  }
  async call<T = unknown>(operation: string, input: unknown = {}): Promise<T> {
    if (this.options.socketPath) { await this.connect(); if(operation === 'authenticate') return this.authentication as T; return this.frame(operation, input) as Promise<T>; }
    let route = routes[operation];
    let body: unknown = input;
    const headers: Record<string, string> = { authorization: `Bearer ${this.options.token}` };
    if (operation === 'publish') {
      route = ['POST', '/api/messages'];
      const pub = input as { message: MessageInput; options: PublishOptions };
      body = pub.message;
      if (pub.options.id) headers['idempotency-key'] = pub.options.id;
      if (pub.options.to) headers['x-notifs-to'] = pub.options.to.join(',');
    } else if (operation === 'subscriptions.remove') {
      route = ['DELETE', `/api/subscriptions/${encodeURIComponent((input as { name: string }).name)}`]; body = undefined;
    } else if (operation === 'inspect') {
      route = ['GET', `/api/messages/${encodeURIComponent((input as { id: string }).id)}`];
    }
    if (!route) throw new Error(`未知客户端操作 ${operation}`);
    if (route[0] !== 'GET' && body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(`${(this.options.baseUrl ?? 'http://127.0.0.1:7710').replace(/\/$/, '')}${route[1]}`, {
      method: route[0], headers,
      body: route[0] === 'GET' || body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(40_000),
    });
    const value = await response.json() as { error?: { code: string; message: string } };
    if (!response.ok) throw new MessagingError(value.error?.code ?? 'http_error', value.error?.message ?? response.statusText, response.status);
    return value as T;
  }
  async send(message: MessageInput, options: PublishOptions = {}): Promise<PublishResult> {
    const stableOptions = { ...options, id: options.id ?? randomUUID() };
    try { return await this.call('publish', { message, options: stableOptions }); }
    catch (err) {
      // One retry of an ambiguous transport result, retaining the same publication ID.
      if (err instanceof MessagingError && !['disconnected', 'timeout'].includes(err.code)) throw err;
      return this.call('publish', { message, options: stableOptions });
    }
  }
  close(): void { this.socket?.destroy(); }
}
