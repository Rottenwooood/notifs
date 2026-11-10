import type { DeliveryAdapter, MessageBatch, SendResult } from '@notify-hub/contracts';

export function validateWebhook(config: unknown): { ok: true } | { ok: false; error: string } {
  const c = config as { url?: unknown; headers?: unknown } | null;
  try {
    const url = new URL(String(c?.url));
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    if (c?.headers !== undefined && (!c.headers || typeof c.headers !== 'object' || Array.isArray(c.headers) || Object.values(c.headers).some(v => typeof v !== 'string'))) throw new Error();
    return { ok: true };
  } catch { return { ok: false, error: 'webhook 要求 HTTP(S) url 和可选的字符串 headers' }; }
}
export async function deliverWebhook(batch: MessageBatch, config: Record<string, unknown>, signal?: AbortSignal): Promise<SendResult> {
  try {
    const response = await fetch(config.url as string, {
      method: 'POST',
      headers: { ...(config.headers as Record<string, string> ?? {}), 'content-type': 'application/json', 'idempotency-key': batch.id },
      body: JSON.stringify({ id: batch.id, endpoint: batch.endpoint, messages: batch.messages }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    });
    return response.ok ? { ok: true } : { ok: false, retryable: response.status >= 500 || response.status === 429, error: `HTTP ${response.status}` };
  } catch (err) { return { ok: false, retryable: true, error: String(err) }; }
}

export const webhookAdapter: DeliveryAdapter = {
  kind: 'webhook',
  validateConfig: validateWebhook,
  deliver: (batch, config, context) => deliverWebhook(batch, config as Record<string, unknown>, context.signal),
};
