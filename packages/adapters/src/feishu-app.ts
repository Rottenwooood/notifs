import type { OutboundAdapter, AdapterMessage, SendContext, SendResult } from '@notify-hub/contracts';

/**
 * 飞书**应用机器人**（开放平台应用，非群自定义机器人）。
 *
 * 与 `feishu`（群自定义机器人 webhook）的区别：
 * - `feishu`     = 群里加一个"自定义机器人"，拿 webhook 地址，只能往那个群发；
 * - `feishu-app` = 用开放平台应用的 App ID/Secret 换 tenant_access_token，
 *                  可往任意会话/用户发（需要相应权限，如 im:message:send_as_bot）。
 *
 * 凭据只写"名字"，值从加密服务环境解析（ctx.resolveSecret），不落进出口配置。
 */
export interface FeishuAppConfig {
  /** 目标 id：群用 chat_id，单聊可用 open_id / user_id / email */
  receiveId: string;
  /** chat_id（默认）| open_id | user_id | union_id | email */
  receiveIdType?: 'chat_id' | 'open_id' | 'user_id' | 'union_id' | 'email';
  /** 凭据在服务环境里的名字，默认 FEISHU_APP_ID / FEISHU_APP_SECRET */
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
    throw new Error(`缺少凭据：服务环境里没有 ${appIdName} / ${secretName}`);
  }

  // 同一 appId 在不同 domain 上是不同凭据，缓存必须带 domain。
  const key = `${domainOf(c)}|${appId}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > ctx.now.getTime()) return cached.token;

  const signal = ctx.signal ? AbortSignal.any([ctx.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
  const res = await fetch(`${domainOf(c)}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
          signal,
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

const MAX_TEXT_CHARS = 18_000;

function clip(text: string): string {
  return text.length <= MAX_TEXT_CHARS ? text : `${text.slice(0, MAX_TEXT_CHARS - 1)}…`;
}

function buildContent(msg: AdapterMessage, c: FeishuAppConfig): string {
  if (c.msgType === 'post') {
    const lines: unknown[][] = [[{ tag: 'text', text: clip(msg.body) }]];
    if (msg.url) lines.push([{ tag: 'a', text: msg.url, href: msg.url }]);
    return JSON.stringify({ zh_cn: { title: clip(msg.title), content: lines } });
  }
  const text = [msg.title, msg.body, msg.url].filter(Boolean).join('\n');
  return JSON.stringify({ text: clip(text) });
}

export const feishuAppAdapter: OutboundAdapter = {
  kind: 'feishu-app',
  validateConfig(cfg) {
    const c = cfg as Partial<FeishuAppConfig> | null;
    if (!c || typeof c.receiveId !== 'string' || !c.receiveId.trim()) {
      return { ok: false, error: 'receiveId 必填（群用 chat_id，单聊用 open_id/email 等）' };
    }
    return { ok: true };
  },
  async send(msg: AdapterMessage, cfg: unknown, ctx: SendContext): Promise<SendResult> {
    const c = cfg as FeishuAppConfig;
    try {
      const token = await tenantToken(c, ctx);
      const type = c.receiveIdType ?? 'chat_id';
      const signal = ctx.signal ? AbortSignal.any([ctx.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
      const res = await fetch(
        `${domainOf(c)}/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(type)}`,
        {
          method: 'POST',
          signal,
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
      // token 失效类错误先清缓存，只允许重试一次换取新 token；其余按限流/权限分类。
      if ([99991661, 99991668].includes(json.code ?? 0)) {
        tokenCache.delete(`${domainOf(c)}|${ctx.resolveSecret(c.appIdSecret ?? 'FEISHU_APP_ID')}`);
        return { ok: false, retryable: ctx.attempt < 2, error: `飞书凭据失效 code=${json.code}: ${json.msg ?? ''}` };
      }
      // 9499 限流可重试；权限被拒等不可重试
      const retryable = json.code === 9499;
      return { ok: false, retryable, error: `飞书返回 code=${json.code}: ${json.msg ?? ''}` };
    } catch (err) {
      return { ok: false, retryable: true, error: `网络错误: ${(err as Error).message}` };
    }
  },
};
