import type { Channel, RenderedMessage, SendResult } from '@notify-hub/contracts';

/** 企业微信机器人（官方 webhook）。 */
export interface WecomConfig {
  webhookKey: string;
  /** markdown（默认，支持加粗/链接）或 text */
  msgtype?: 'markdown' | 'text';
  mentionedList?: string[];
}

function buildContent(msg: RenderedMessage, c: WecomConfig): string {
  if (c.msgtype === 'text') {
    return [msg.title, msg.body, msg.url].filter(Boolean).join('\n');
  }
  const lines = [`**${msg.title}**`, msg.body];
  if (msg.url) lines.push(`[打开](${msg.url})`);
  let content = lines.filter(Boolean).join('\n');
  const mentions = (c.mentionedList ?? []).map((m) => `<@${m}>`).join(' ');
  if (mentions) content += `\n${mentions}`;
  return content;
}

export const wecomChannel: Channel = {
  kind: 'wecom',
  validateConfig(cfg) {
    const c = cfg as Partial<WecomConfig> | null;
    if (!c || typeof c.webhookKey !== 'string' || !c.webhookKey) return { ok: false, error: 'webhookKey 必填' };
    return { ok: true };
  },
  async send(msg: RenderedMessage, cfg: unknown): Promise<SendResult> {
    const c = cfg as WecomConfig;
    const url = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${encodeURIComponent(c.webhookKey)}`;
    const body = {
      msgtype: c.msgtype ?? 'markdown',
      [c.msgtype ?? 'markdown']: { content: buildContent(msg, c) },
    };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const retryable = res.status >= 500 || res.status === 429;
        return { ok: false, retryable, error: `HTTP ${res.status}` };
      }
      const json = (await res.json().catch(() => ({}))) as { errcode?: number; errmsg?: string };
      if (json.errcode === 0) return { ok: true, providerId: 'wecom' };
      // 45009 = 接口调用超过限制，可重试；其余按不可重试处理
      const retryable = json.errcode === 45009 || json.errcode === -1;
      return { ok: false, retryable, error: `errcode ${json.errcode}: ${json.errmsg ?? ''}` };
    } catch (err) {
      return { ok: false, retryable: true, error: `网络错误: ${(err as Error).message}` };
    }
  },
};
