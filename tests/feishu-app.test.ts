import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { feishuAppChannel } from '@notify-hub/channels';
import type { RenderedMessage, SendContext, SendResult } from '@notify-hub/contracts';

const msg: RenderedMessage = {
  title: 'PR #123 有新回复',
  body: 'Alice: 麻烦补个测试。',
  url: 'https://github.com/o/r/pull/123',
  severity: 'info',
  event_id: '01M4',
};

function ctxWith(secrets: Record<string, string>): SendContext {
  return {
    channelId: 'c1',
    channelName: 'feishu-app',
    deliveryId: 'd1',
    attempt: 1,
    idempotencyKey: 'k',
    now: new Date('2026-10-12T00:00:00Z'),
    resolveSecret: (name) => secrets[name],
  };
}

let calls: { url: string; init: RequestInit }[] = [];

function stubFetch(router: (url: string, init: RequestInit) => { status: number; json: unknown }) {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = router(url, init);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json, text: async () => '' };
  });
}

const SECRETS = { FEISHU_APP_ID: 'cli_x', FEISHU_APP_SECRET: 'sec' };

beforeEach(() => {
  calls = [];
});
afterEach(() => vi.unstubAllGlobals());

describe('飞书应用机器人出口（feishu-app）', () => {
  it('先换 token 再发消息，凭据从密钥库按名解析', async () => {
    stubFetch((url) =>
      url.includes('tenant_access_token')
        ? { status: 200, json: { code: 0, tenant_access_token: 't-123', expire: 7200 } }
        : { status: 200, json: { code: 0, data: { message_id: 'om_1' } } },
    );
    const res = await feishuAppChannel.send(msg, { receiveId: 'oc_abc' }, ctxWith(SECRETS));
    expect(res).toMatchObject({ ok: true, providerId: 'om_1' });

    expect(calls[0]!.url).toContain('/open-apis/auth/v3/tenant_access_token/internal');
    expect(calls[1]!.url).toContain('/open-apis/im/v1/messages?receive_id_type=chat_id');
    const body = JSON.parse(calls[1]!.init.body as string);
    expect(body.receive_id).toBe('oc_abc');
    expect(body.msg_type).toBe('text');
    expect(JSON.parse(body.content).text).toContain(msg.title);
  });

  it('token 会被缓存（第二轮不再换取）', async () => {
    stubFetch((url) =>
      url.includes('tenant_access_token')
        ? { status: 200, json: { code: 0, tenant_access_token: 't-cache', expire: 7200 } }
        : { status: 200, json: { code: 0, data: {} } },
    );
    const ctx = ctxWith({ FEISHU_APP_ID: 'cli_cache_test', FEISHU_APP_SECRET: 's' });
    await feishuAppChannel.send(msg, { receiveId: 'oc_1' }, ctx);
    await feishuAppChannel.send(msg, { receiveId: 'oc_1' }, ctx);
    const tokenCalls = calls.filter((c) => c.url.includes('tenant_access_token'));
    expect(tokenCalls).toHaveLength(1);
  });

  it('缺凭据 → 明确报错且可重试', async () => {
    stubFetch(() => ({ status: 200, json: { code: 0, tenant_access_token: 'x', expire: 7200 } }));
    const res: SendResult = await feishuAppChannel.send(msg, { receiveId: 'oc_1' }, ctxWith({}));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('缺少凭据');
  });

  it('receive_id_type 可选；post 富文本', async () => {
    stubFetch((url) =>
      url.includes('tenant_access_token')
        ? { status: 200, json: { code: 0, tenant_access_token: 't', expire: 7200 } }
        : { status: 200, json: { code: 0, data: {} } },
    );
    await feishuAppChannel.send(
      msg,
      { receiveId: 'a@b.com', receiveIdType: 'email', msgType: 'post' },
      ctxWith(SECRETS),
    );
    const send = calls.find((c) => c.url.includes('/im/v1/messages'))!;
    expect(send.url).toContain('receive_id_type=email');
    expect(JSON.parse(send.init.body as string).msg_type).toBe('post');
  });

  it('返回码语义：9499 可重试、权限被拒不可重试', async () => {
    stubFetch((url) =>
      url.includes('tenant_access_token')
        ? { status: 200, json: { code: 0, tenant_access_token: 't', expire: 7200 } }
        : { status: 200, json: { code: 9499, msg: 'rate limit' } },
    );
    expect(await feishuAppChannel.send(msg, { receiveId: 'oc_1' }, ctxWith(SECRETS))).toMatchObject({
      retryable: true,
    });

    calls = [];
    stubFetch((url) =>
      url.includes('tenant_access_token')
        ? { status: 200, json: { code: 0, tenant_access_token: 't', expire: 7200 } }
        : { status: 200, json: { code: 99991663, msg: 'no permission' } },
    );
    expect(await feishuAppChannel.send(msg, { receiveId: 'oc_1' }, ctxWith(SECRETS))).toMatchObject({
      ok: false,
      retryable: false,
    });
  });

  it('配置校验', () => {
    expect(feishuAppChannel.validateConfig({}).ok).toBe(false);
    expect(feishuAppChannel.validateConfig({ receiveId: 'oc_1' }).ok).toBe(true);
  });
});
