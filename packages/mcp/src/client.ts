/** notifs 的 HTTP 客户端。MCP 进程不碰数据库，只跟本地常驻的中心说话。 */

export interface SendInput {
  type: string;
  text: string;
  title?: string;
  url?: string;
  severity?: 'info' | 'warn' | 'critical';
  dedup_key?: string;
  data?: Record<string, unknown>;
}

export class NotifyClient {
  private readonly base: string;
  private readonly token: string;

  constructor(opts: { baseUrl: string; token: string }) {
    this.base = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
  }

  private async call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    const raw = await res.text();
    let parsed: unknown = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = { raw };
    }

    if (!res.ok) {
      const message =
        (parsed as { error?: string })?.error ?? raw.slice(0, 300) ?? `HTTP ${res.status}`;
      throw new Error(`HTTP ${res.status}: ${message}`);
    }
    return parsed;
  }

  send(input: SendInput): Promise<unknown> {
    return this.call('POST', '/api/v1/events', input);
  }

  events(limit = 20, type?: string): Promise<unknown> {
    const q = new URLSearchParams({ limit: String(limit) });
    if (type) q.set('type', type);
    return this.call('GET', `/api/v1/events?${q.toString()}`);
  }

  deliveries(limit = 20, status?: string): Promise<unknown> {
    const q = new URLSearchParams({ limit: String(limit) });
    if (status) q.set('status', status);
    return this.call('GET', `/api/v1/deliveries?${q.toString()}`);
  }

  status(): Promise<unknown> {
    return this.call('GET', '/api/v1/status');
  }
}
