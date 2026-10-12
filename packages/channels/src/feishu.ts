import { createHmac } from 'node:crypto';
import type { Channel, RenderedMessage, SendResult } from '@notify-hub/contracts';

/**
 * 飞书自定义机器人（官方 webhook）。
 * 建机器人：飞书群 → 设置 → 群机器人 → 添加机器人 → 自定义机器人；
 * 复制 webhook（形如 https://open.feishu.cn/open-apis/bot/v2/hook/xxxx），
 * 若开启"签名校验"，把密钥填到 secret。
 */
export interface FeishuConfig {
  /** 完整 webhook 地址，或只填末段 token（此时用官方域名） */
  webhook: string;
  /** 加签密钥（机器人开启了"签名校验"时必填） */
  secret?: string;
  /** text（默认，支持 @）或 post（富文本，标题+正文+链接） */
  msgType?: 'text' | 'post';
  /** @ 谁：用户的 open_id / user_id / email，或 "all" 表示所有人 */
  mentions?: string[];
}

function resolveUrl(webhook: string): string {
  const w = webhook.trim();
  return /^https?:\/\//i.test(w) ? w : `https://open.feishu.cn/open-apis/bot/v2/hook/${encodeURIComponent(w)}`;
}

/** 飞书加签：以 "{timestamp}\n{secret}" 为 HMAC 钥匙、对空串做 SHA256，再 base64。 */
export function feishuSign(secret: string, timestampSeconds: number): string {
  const stringToSign = `${timestampSeconds}\n${secret}`;
  return createHmac('sha256', stringToSign).update('').digest('base64');
}

function mentionSuffix(mentions: string[] | undefined): string {
  if (!mentions?.length) return '';
  return (
    '\n' +
    mentions
      .map((m) =>
        m === 'all' || m === '所有人'
          ? '<at user_id="all">所有人</at>'
          : `<at user_id="${m}"></at>`,
      )
      .join(' ')
  );
}

export function buildFeishuBody(
  msg: RenderedMessage,
  c: FeishuConfig,
  now: Date = new Date(),
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (c.secret) {
    const ts = Math.floor(now.getTime() / 1000);
    body['timestamp'] = String(ts);
    body['sign'] = feishuSign(c.secret, ts);
  }

  if (c.msgType === 'post') {
    const lines: unknown[][] = [[{ tag: 'text', text: msg.body }]];
    if (msg.url) lines.push([{ tag: 'a', text: msg.url, href: msg.url }]);
    body['msg_type'] = 'post';
    body['content'] = {
      post: { zh_cn: { title: msg.title, content: lines } },
    };
    return body;
  }

  body['msg_type'] = 'text';
  body['content'] = {
    text: [msg.title, msg.body, msg.url].filter(Boolean).join('\n') + mentionSuffix(c.mentions),
  };
  return body;
}

export const feishuChannel: Channel = {
  kind: 'feishu',
  validateConfig(cfg) {
    const c = cfg as Partial<FeishuConfig> | null;
    if (!c || typeof c.webhook !== 'string' || !c.webhook.trim()) {
      return { ok: false, error: 'webhook 必填（完整地址或末段 token）' };
    }
    return { ok: true };
  },
  async send(msg: RenderedMessage, cfg: unknown): Promise<SendResult> {
    const c = cfg as FeishuConfig;
    try {
      const res = await fetch(resolveUrl(c.webhook), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildFeishuBody(msg, c)),
      });
      if (!res.ok) {
        const retryable = res.status >= 500 || res.status === 429;
        return { ok: false, retryable, error: `HTTP ${res.status}` };
      }
      const json = (await res.json().catch(() => ({}))) as { code?: number; msg?: string; StatusCode?: number };
      const code = json.code ?? json.StatusCode;
      if (code === 0) return { ok: true, providerId: 'feishu' };
      // 9499 = 请求过于频繁（限流），可重试；其余（如 19001 参数错、19021 签名错）不可重试
      const retryable = code === 9499 || code === 11232;
      return { ok: false, retryable, error: `飞书返回 code=${code}: ${json.msg ?? ''}` };
    } catch (err) {
      return { ok: false, retryable: true, error: `网络错误: ${(err as Error).message}` };
    }
  },
};
