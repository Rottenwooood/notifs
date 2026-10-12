import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFeishuBody, feishuChannel, feishuSign } from '@notify-hub/channels';
import type { RenderedMessage } from '@notify-hub/contracts';

const msg: RenderedMessage = {
  title: 'PR #123 有新回复',
  body: 'Alice: 麻烦补个测试。',
  markdown: 'Alice: 麻烦补个测试。',
  url: 'https://github.com/o/r/pull/123',
  severity: 'info',
  event_id: '01M4',
};

function mockFetch(status: number, json: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => json, text: async () => '' };
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('飞书自定义机器人（§5.6.2）', () => {
  it('加签算法与飞书文档一致（固定输入 → 固定签名）', () => {
    expect(feishuSign('test-secret', 1_700_000_000)).toBe('mbm4Y4oluIPQ00qlBIhX8vAZ0EKv3nw0LuTb91jPL84=');
  });

  it('text 消息包含标题/正文/链接', () => {
    const body = buildFeishuBody(msg, { webhook: 'tok' });
    expect(body['msg_type']).toBe('text');
    const text = (body['content'] as { text: string }).text;
    expect(text).toContain(msg.title);
    expect(text).toContain(msg.body);
    expect(text).toContain(msg.url);
  });

  it('@ 所有人 与 @ 指定用户', () => {
    const all = buildFeishuBody(msg, { webhook: 'tok', mentions: ['all'] });
    expect((all['content'] as { text: string }).text).toContain('<at user_id="all">');
    const one = buildFeishuBody(msg, { webhook: 'tok', mentions: ['ou_abc'] });
    expect((one['content'] as { text: string }).text).toContain('<at user_id="ou_abc">');
  });

  it('post 富文本结构', () => {
    const body = buildFeishuBody(msg, { webhook: 'tok', msgType: 'post' });
    expect(body['msg_type']).toBe('post');
    const post = (body['content'] as { post: { zh_cn: { title: string; content: unknown[][] } } }).post.zh_cn;
    expect(post.title).toBe(msg.title);
    expect(post.content.length).toBe(2); // 正文一段 + 链接一段
  });

  it('开了 secret 时带上 timestamp 与 sign', () => {
    const body = buildFeishuBody(msg, { webhook: 'tok', secret: 's3cr3t' }, new Date(1_700_000_000_000));
    expect(body['timestamp']).toBe('1700000000');
    expect(typeof body['sign']).toBe('string');
  });

  it('webhook 支持完整地址或纯 token', async () => {
    const calls = mockFetch(200, { code: 0 });
    await feishuChannel.send(msg, { webhook: 'abc123' }, {} as never);
    expect(calls[0]!.url).toBe('https://open.feishu.cn/open-apis/bot/v2/hook/abc123');

    const calls2 = mockFetch(200, { code: 0 });
    await feishuChannel.send(msg, { webhook: 'https://open.larksuite.com/open-apis/bot/v2/hook/xyz' }, {} as never);
    expect(calls2[0]!.url).toBe('https://open.larksuite.com/open-apis/bot/v2/hook/xyz');
  });

  it('返回码语义：0 成功、9499 可重试、19021 不可重试、HTTP 5xx 可重试', async () => {
    mockFetch(200, { code: 0 });
    expect((await feishuChannel.send(msg, { webhook: 't' }, {} as never)).ok).toBe(true);

    mockFetch(200, { code: 9499, msg: 'too many requests' });
    expect(await feishuChannel.send(msg, { webhook: 't' }, {} as never)).toMatchObject({ retryable: true });

    mockFetch(200, { code: 19021, msg: 'sign match fail' });
    expect(await feishuChannel.send(msg, { webhook: 't' }, {} as never)).toMatchObject({
      ok: false,
      retryable: false,
    });

    mockFetch(503, {});
    expect(await feishuChannel.send(msg, { webhook: 't' }, {} as never)).toMatchObject({ retryable: true });
  });

  it('配置校验', () => {
    expect(feishuChannel.validateConfig({}).ok).toBe(false);
    expect(feishuChannel.validateConfig({ webhook: '  ' }).ok).toBe(false);
    expect(feishuChannel.validateConfig({ webhook: 't' }).ok).toBe(true);
  });
});
