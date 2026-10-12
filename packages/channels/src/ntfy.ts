import type { Channel, RenderedMessage, SendResult } from '@notify-hub/contracts';

/** ntfy（手机推送，可自建服务器）。 */
export interface NtfyConfig {
  topic: string;
  server?: string;
  token?: string;
  priority?: 1 | 2 | 3 | 4 | 5;
  tags?: string[];
}

export const ntfyChannel: Channel = {
  kind: 'ntfy',
  validateConfig(cfg) {
    const c = cfg as Partial<NtfyConfig> | null;
    if (!c || typeof c.topic !== 'string' || !c.topic) return { ok: false, error: 'topic 必填' };
    return { ok: true };
  },
  async send(msg: RenderedMessage, cfg: unknown): Promise<SendResult> {
    const c = cfg as NtfyConfig;
    const base = (c.server ?? 'https://ntfy.sh').replace(/\/+$/, '');
    const headers: Record<string, string> = {
      Title: msg.title,
      Priority: String(c.priority ?? (msg.severity === 'critical' ? 5 : msg.severity === 'warn' ? 4 : 3)),
    };
    if (msg.url) headers['Click'] = msg.url;
    if (c.tags?.length) headers['Tags'] = c.tags.join(',');
    if (c.token) headers['Authorization'] = `Bearer ${c.token}`;
    try {
      const res = await fetch(`${base}/${encodeURIComponent(c.topic)}`, {
        method: 'POST',
        headers,
        body: msg.body,
      });
      if (res.ok) return { ok: true, providerId: `ntfy-${res.status}` };
      const retryable = res.status >= 500 || res.status === 429;
      return { ok: false, retryable, error: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, retryable: true, error: `网络错误: ${(err as Error).message}` };
    }
  },
};
