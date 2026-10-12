import type { Channel, RenderedMessage, SendContext, SendResult } from '@notify-hub/contracts';

/**
 * 飞书**应用机器人**（开放平台应用，非群自定义机器人）。
 *
 * 与 `feishu`（群自定义机器人 webhook）的区别：
 * - `feishu`     = 群里加一个"自定义机器人"，拿 webhook 地址，只能往那个群发；
 * - `feishu-app` = 用开放平台应用的 App ID/Secret 换 tenant_access_token，
 *                  可往任意会话/用户发（需要相应权限，如 im:message:send_as_bot）。
 *
 * 凭据只写"名字"，值从加密密钥库解析（ctx.resolveSecret），不落进出口配置。
 */
export interface FeishuAppConfig {
  /** 目标 id：群用 chat_id，单聊可用 open_id / user_id / email */
  receiveId: string;
  /** chat_id（默认）| open_id | user_id | union_id | email */
  receiveIdType?: 'chat_id' | 'open_id' | 'user_id' | 'union_id' | 'email';
  /** 凭据在密钥库里的名字，默认 FEISHU_APP_ID / FEISHU_APP_SECRET */
  appIdSecret?: string;
  appSecretSecret?: string;
  /** text（默认）或 post（富文本） */
  msgType?: 'text' | 'post';
  /** open.feishu.cn（默认）或 open.larksuite.com */
  domain?: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}
const tokenCache = new Map<string, CachedToken>();

function domainOf(c: FeishuAppConfig): string {
  return (c.domain ?? 'https://open.feishu.cn').replace(/\/+$/, '');
}

/** 换取（并缓存）tenant_access_token。 */
async function tenantToken(c: FeishuAppConfig, ctx: SendContext): Promise<string> {
  const appIdName = c.appIdSecret ?? 'FEISHU_APP_ID';
  const secretName = c.appSecretSecret ?? 'FEISHU_APP_SECRET';
  const appId = ctx.resolveSecret(appIdName);
  const appSecret = ctx.resolveSecret(secretName);
  if (!appId || !appSecret) {
    throw new Error(`缺少凭据：密钥库里没有 ${appIdName} / ${secretName}`);
  }

  const key = `${appId}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > ctx.now.getTime()) return cached.token;

  const res = await fetch(`${domainOf(c)}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const json = (await res.json()) as {
    code?: number;
    msg?: string;
    tenant_access_token?: string;
    expire?: number;
  };
  if (json.code !== 0 || !json.tenant_access_token) {
    throw new Error(`换取 tenant_access_token 失败: code=${json.code} ${json.msg ?? ''}`);
  }
  // 提前 5 分钟过期，避免边界
  const ttlMs = Math.max(60, (json.expire ?? 7200) - 300) * 1000;
  tokenCache.set(key, { token: json.tenant_access_token, expiresAt: ctx.now.getTime() + ttlMs });
  return json.tenant_access_token;
}

function buildContent(msg: RenderedMessage, c: FeishuAppConfig): string {
  if (c.msgType === 'post') {
    const lines: unknown[][] = [[{ tag: 'text', text: msg.body }]];
    if (msg.url) lines.push([{ tag: 'a', text: msg.url, href: msg.url }]);
    return JSON.stringify({ zh_cn: { title: msg.title, content: lines } });
  }
  const text = [msg.title, msg.body, msg.url].filter(Boolean).join('\n');
  return JSON.stringify({ text });
}

export const feishuAppChannel: Channel = {
  kind: 'feishu-app',
  validateConfig(cfg) {
    const c = cfg as Partial<FeishuAppConfig> | null;
    if (!c || typeof c.receiveId !== 'string' || !c.receiveId.trim()) {
      return { ok: false, error: 'receiveId 必填（群用 chat_id，单聊用 open_id/email 等）' };
    }
    return { ok: true };
  },
  async send(msg: RenderedMessage, cfg: unknown, ctx: SendContext): Promise<SendResult> {
    const c = cfg as FeishuAppConfig;
    try {
      const token = await tenantToken(c, ctx);
      const type = c.receiveIdType ?? 'chat_id';
      const res = await fetch(
        `${domainOf(c)}/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(type)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({
            receive_id: c.receiveId,
            msg_type: c.msgType ?? 'text',
            content: buildContent(msg, c),
          }),
        },
      );
      if (!res.ok) {
        const retryable = res.status >= 500 || res.status === 429;
        return { ok: false, retryable, error: `HTTP ${res.status}` };
      }
      const json = (await res.json()) as { code?: number; msg?: string; data?: { message_id?: string } };
      if (json.code === 0) return { ok: true, providerId: json.data?.message_id ?? 'feishu-app' };
      // 9499 限流；99991663 权限被拒（不可重试）
      const retryable = json.code === 9499;
      return { ok: false, retryable, error: `飞书返回 code=${json.code}: ${json.msg ?? ''}` };
    } catch (err) {
      return { ok: false, retryable: true, error: `网络错误: ${(err as Error).message}` };
    }
  },
};
