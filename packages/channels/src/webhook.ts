import type { Channel, RenderedMessage, SendContext, SendResult } from '@notify-hub/contracts';

/** 任意 HTTP 端点（万能兜底，§5.6.2）。 */
export interface WebhookConfig {
  url: string;
  method?: 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  /** 自定义 body 模板，支持 {{title}} {{body}} {{markdown}} {{url}} {{severity}} {{event_id}} */
  bodyTemplate?: string;
  timeoutMs?: number;
  /** 是否带上幂等头（默认 true） */
  idempotencyHeader?: boolean;
}

export function renderTemplate(tpl: string, msg: RenderedMessage): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => {
    const v = (msg as unknown as Record<string, unknown>)[k];
    return v == null ? '' : String(v);
  });
}

export const webhookChannel: Channel = {
  kind: 'webhook',
  validateConfig(cfg) {
    const c = cfg as Partial<WebhookConfig> | null;
    if (!c || typeof c.url !== 'string' || !c.url) return { ok: false, error: 'url 必填' };
    try {
      new URL(c.url);
    } catch {
      return { ok: false, error: 'url 非法' };
    }
    return { ok: true };
  },
  async send(msg: RenderedMessage, cfg: unknown, ctx: SendContext): Promise<SendResult> {
    const c = cfg as WebhookConfig;
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(c.headers ?? {}) };
    if (c.idempotencyHeader !== false) headers['x-notify-idempotency-key'] = ctx.idempotencyKey;
    const body = c.bodyTemplate
      ? renderTemplate(c.bodyTemplate, msg)
      : JSON.stringify({
          title: msg.title,
          body: msg.body,
          markdown: msg.markdown,
          url: msg.url,
          severity: msg.severity,
          event_id: msg.event_id,
        });
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), c.timeoutMs ?? 10_000);
    try {
      const res = await fetch(c.url, {
        method: c.method ?? 'POST',
        headers,
        body,
        signal: ac.signal,
      });
      if (res.ok) return { ok: true, providerId: `http-${res.status}` };
      const text = await res.text().catch(() => '');
      const retryable = res.status >= 500 || res.status === 429;
      return { ok: false, retryable, error: `HTTP ${res.status} ${text.slice(0, 200)}` };
    } catch (err) {
      return { ok: false, retryable: true, error: `网络错误: ${(err as Error).message}` };
    } finally {
      clearTimeout(timer);
    }
  },
};
