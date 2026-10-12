import type { Channel, RenderedMessage, SendResult } from '@notify-hub/contracts';

/** Bark（iOS 推送）。 */
export interface BarkConfig {
  key: string;
  server?: string;
  group?: string;
  sound?: string;
  level?: 'active' | 'timeSensitive' | 'passive';
}

export const barkChannel: Channel = {
  kind: 'bark',
  validateConfig(cfg) {
    const c = cfg as Partial<BarkConfig> | null;
    if (!c || typeof c.key !== 'string' || !c.key) return { ok: false, error: 'key 必填' };
    return { ok: true };
  },
  async send(msg: RenderedMessage, cfg: unknown): Promise<SendResult> {
    const c = cfg as BarkConfig;
    const base = (c.server ?? 'https://api.day.app').replace(/\/+$/, '');
    const payload: Record<string, unknown> = { title: msg.title, body: msg.body };
    if (msg.url) payload['url'] = msg.url;
    if (c.group) payload['group'] = c.group;
    if (c.sound) payload['sound'] = c.sound;
    if (c.level) payload['level'] = c.level;
    try {
      const res = await fetch(`${base}/${encodeURIComponent(c.key)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const retryable = res.status >= 500 || res.status === 429;
        return { ok: false, retryable, error: `HTTP ${res.status}` };
      }
      const json = (await res.json().catch(() => ({}))) as { code?: number; message?: string };
      if (typeof json.code === 'number' && json.code !== 200) {
        return { ok: false, retryable: false, error: `Bark code ${json.code}: ${json.message ?? ''}` };
      }
      return { ok: true, providerId: 'bark' };
    } catch (err) {
      return { ok: false, retryable: true, error: `网络错误: ${(err as Error).message}` };
    }
  },
};
