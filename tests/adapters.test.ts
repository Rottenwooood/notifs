import { afterEach, describe, expect, it, vi } from 'vitest';
import { barkAdapter, getAdapter, ntfyAdapter, wecomAdapter, deliverWebhook, validateWebhook } from '@notify-hub/adapters';
import type { AdapterMessage, MessageBatch, SendContext } from '@notify-hub/contracts';

const msg: AdapterMessage = {
  title: 'PR #123 有新回复',
  body: 'Alice: 麻烦补个测试。',
  markdown: 'Alice: 麻烦补个测试。',
  url: 'https://github.com/o/r/pull/123',
  severity: 'warn',
  message_id: '01M4',
};
const ctx: SendContext = {
  endpoint: 'c1',
  deliveryId: 'd1',
  attempt: 1,
  idempotencyKey: 'idem-1',
  now: new Date('2026-10-12T00:00:00Z'),
  resolveSecret: () => undefined,
};

function mockFetch(impl: (url: string, init: RequestInit) => { status: number; json?: unknown; text?: string }) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = impl(url, init);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.json ?? {},
      text: async () => r.text ?? '',
    };
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('通道实现', () => {
  it('ntfy：发到 topic，带 Title/Priority/Click 头', async () => {
    const calls = mockFetch(() => ({ status: 200 }));
    const res = await ntfyAdapter.send(msg, { topic: 'my-topic' }, ctx);
    expect(res.ok).toBe(true);
    expect(calls[0]!.url).toBe('https://ntfy.sh/my-topic');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['Title']).toBe(msg.title);
    expect(headers['Priority']).toBe('4'); // warn
    expect(headers['Click']).toBe(msg.url);
  });

  it('ntfy：自定义 server', async () => {
    const calls = mockFetch(() => ({ status: 200 }));
    await ntfyAdapter.send(msg, { topic: 't', server: 'https://ntfy.example.com/' }, ctx);
    expect(calls[0]!.url).toBe('https://ntfy.example.com/t');
  });

  it('ntfy：5xx 可重试，4xx 不可重试', async () => {
    mockFetch(() => ({ status: 503 }));
    expect(await ntfyAdapter.send(msg, { topic: 't' }, ctx)).toMatchObject({ retryable: true });
    mockFetch(() => ({ status: 400 }));
    expect(await ntfyAdapter.send(msg, { topic: 't' }, ctx)).toMatchObject({ retryable: false });
  });

  it('bark：POST JSON，识别 code!==200', async () => {
    const calls = mockFetch(() => ({ status: 200, json: { code: 200 } }));
    expect((await barkAdapter.send(msg, { key: 'k' }, ctx)).ok).toBe(true);
    expect(calls[0]!.url).toBe('https://api.day.app/k');
    expect(JSON.parse(calls[0]!.init.body as string).title).toBe(msg.title);

    mockFetch(() => ({ status: 200, json: { code: 400, message: 'bad key' } }));
    const bad = await barkAdapter.send(msg, { key: 'k' }, ctx);
    expect(bad).toMatchObject({ ok: false, retryable: false });
  });

  it('wecom：errcode 0 成功，45009 可重试', async () => {
    const calls = mockFetch(() => ({ status: 200, json: { errcode: 0 } }));
    expect((await wecomAdapter.send(msg, { webhookKey: 'KEY' }, ctx)).ok).toBe(true);
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.msgtype).toBe('markdown');
    expect(body.markdown.content).toContain(msg.title);

    mockFetch(() => ({ status: 200, json: { errcode: 45009, errmsg: 'api freq out of limit' } }));
    expect(await wecomAdapter.send(msg, { webhookKey: 'KEY' }, ctx)).toMatchObject({ retryable: true });
  });

  it('webhook：带幂等头，5xx 可重试', async () => {
    const calls = mockFetch(() => ({ status: 500, text: 'boom' }));
    const res = await deliverWebhook({id:'batch',endpoint:'test',lease:'lease',lease_until:0,attempt:1,messages:[]}, { url: 'http://x/y' });
    expect(res).toMatchObject({ ok: false, retryable: true });
    expect((calls[0]!.init.headers as Record<string, string>)['idempotency-key']).toBe('batch');
  });

  it('配置校验', () => {
    expect(ntfyAdapter.validateConfig({}).ok).toBe(false);
    expect(ntfyAdapter.validateConfig({ topic: 't' }).ok).toBe(true);
    expect(barkAdapter.validateConfig({ key: 'k' }).ok).toBe(true);
    expect(wecomAdapter.validateConfig({ webhookKey: 'w' }).ok).toBe(true);
    expect(validateWebhook({ url: 'not-a-url' }).ok).toBe(false);
  });
});


it('统一 adapter 契约：一个限频窗口的人类渠道只发一条合并消息', async () => {
  const batch: MessageBatch = {
    id: 'batch-1', endpoint: 'phone', lease: 'lease', lease_until: 0, attempt: 1,
    messages: [
      { id: 'm1', source: 'last-order', type: 'note', content: '第一条', received_at: '2026-11-10T00:00:00Z' },
      { id: 'm2', source: 'worker', type: 'result', content: { title: '结果', body: '第二条' }, received_at: '2026-11-10T00:00:01Z' },
    ],
  };
  const calls = mockFetch(() => ({ status: 200, json: { code: 0 } }));
  const adapter = getAdapter('feishu')!;
  const result = await adapter.deliver(batch, { webhook: 'http://feishu.test/hook' }, {
    endpoint: 'phone', batchId: batch.id, attempt: 1, now: new Date('2026-11-10T00:00:02Z'), resolveSecret: () => undefined,
  });
  expect(result.ok).toBe(true);
  expect(calls).toHaveLength(1);
  const body = JSON.parse(calls[0]!.init.body as string);
  expect(body.content.text).toContain('2 条消息');
  expect(body.content.text).toContain('第一条');
  expect(body.content.text).toContain('第二条');
});
