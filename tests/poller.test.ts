import { describe, expect, it } from 'vitest';
import { PollerSpecSchema, type PollerSpec } from '@notify-hub/contracts';
import { buildEvent, parseInterval, resolveMapValue, runPoller } from '@notify-hub/producers';

function spec(partial: Record<string, unknown>): PollerSpec {
  return PollerSpecSchema.parse({
    request: { url: 'http://localhost/api' },
    key: '$.id',
    change: { on: 'new_item' },
    map: { type: '"demo.item"', text: '$.body' },
    ...partial,
  });
}

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers });

const emptyState = () => ({ items: {} as Record<string, string> });

describe('parseInterval', () => {
  it('解析常见单位', () => {
    expect(parseInterval('60s')).toBe(60_000);
    expect(parseInterval('5m')).toBe(300_000);
    expect(parseInterval('1h')).toBe(3_600_000);
    expect(parseInterval('500ms')).toBe(500);
    expect(parseInterval('90')).toBe(90_000);
  });
  it('非法输入抛错', () => {
    expect(() => parseInterval('abc')).toThrow();
  });
});

describe('resolveMapValue 取值语义', () => {
  const item = { id: 7, body: 'hello' };
  it('$ → 整个条目', () => expect(resolveMapValue('$', item)).toEqual(item));
  it('表达式', () => expect(resolveMapValue('$.body', item)).toBe('hello'));
  it('字面量', () => expect(resolveMapValue('"github.pr.reply"', item)).toBe('github.pr.reply'));
  it('插值', () => expect(resolveMapValue('"pr:{{ id }}"', item)).toBe('pr:7'));
});

describe('poller 变化检测（§5.3.3）', () => {
  it('new_item：首轮全报，重复不报，新增才报', async () => {
    const s = spec({ change: { on: 'new_item' }, extract: '$[*]' });
    const items = [{ id: 1, body: 'a' }, { id: 2, body: 'b' }];

    const first = await runPoller(s, emptyState(), { fetchImpl: async () => json(items) });
    expect(first.events.map((e) => e.text)).toEqual(['a', 'b']);

    const again = await runPoller(s, first.state, { fetchImpl: async () => json(items) });
    expect(again.events).toHaveLength(0);

    const grown = await runPoller(s, again.state, {
      fetchImpl: async () => json([...items, { id: 3, body: 'c' }]),
    });
    expect(grown.events.map((e) => e.text)).toEqual(['c']);
  });

  it('field_changed：字段变了才报', async () => {
    const s = spec({
      change: { on: 'field_changed', field: '$.updated_at' },
      extract: '$[*]',
      map: { type: '"x"', text: '$.body' },
    });
    const v1 = [{ id: 1, body: 'a', updated_at: 't1' }];
    const v2 = [{ id: 1, body: 'a2', updated_at: 't2' }];
    const v3 = [{ id: 1, body: 'a2', updated_at: 't2' }];

    const r1 = await runPoller(s, emptyState(), { fetchImpl: async () => json(v1) });
    expect(r1.events).toHaveLength(1);
    const r2 = await runPoller(s, r1.state, { fetchImpl: async () => json(v2) });
    expect(r2.events).toHaveLength(1);
    const r3 = await runPoller(s, r2.state, { fetchImpl: async () => json(v3) });
    expect(r3.events).toHaveLength(0);
  });

  it('threshold：只在跨过阈值时触发一次', async () => {
    const s = spec({
      change: { on: 'threshold', field: '$.price', op: 'lt', value: 100 },
      extract: '$[*]',
      map: { type: '"price.alert"', text: '"价格跌破 100"' },
    });
    const above = [{ id: 1, price: 120 }];
    const below = [{ id: 1, price: 80 }];
    const stillBelow = [{ id: 1, price: 70 }];

    const r1 = await runPoller(s, emptyState(), { fetchImpl: async () => json(above) });
    expect(r1.events).toHaveLength(0);
    const r2 = await runPoller(s, r1.state, { fetchImpl: async () => json(below) });
    expect(r2.events).toHaveLength(1);
    const r3 = await runPoller(s, r2.state, { fetchImpl: async () => json(stillBelow) });
    expect(r3.events).toHaveLength(0);
  });

  it('单个条目的映射错误被跳过并记录，不拖垮整轮', async () => {
    const s = spec({ change: { on: 'new_item' }, extract: '$[*]', map: { type: '"t"', text: '$.body' } });
    const items = [{ id: 1, body: 'ok' }, { id: 2 /* 缺 body → text 为空，非法 */ }];
    const r = await runPoller(s, emptyState(), { fetchImpl: async () => json(items) });
    expect(r.events).toHaveLength(1);
    expect(r.events[0]!.text).toBe('ok');
    expect(r.errors).toHaveLength(1);
    expect(r.state.items['2']).toBe('1'); // 仍推进，避免每轮重试
  });

  it('304 → 不产出事件，且快照不变', async () => {
    const s = spec({ request: { url: 'http://x/y', conditional: { etag: true } } });
    const state = { items: { 1: '1' }, etag: 'W/"abc"' };
    const r = await runPoller(s, state, {
      fetchImpl: async () => new Response(null, { status: 304 }),
    });
    expect(r.notModified).toBe(true);
    expect(r.events).toHaveLength(0);
    expect(r.state).toBe(state);
  });

  it('请求失败抛错（由调用方保证不推进快照）', async () => {
    const s = spec({});
    await expect(
      runPoller(s, emptyState(), { fetchImpl: async () => new Response('x', { status: 500 }) }),
    ).rejects.toThrow(/500/);
  });

  it('headers 里的 {{secrets.X}} 被替换，并带上条件请求头', async () => {
    const s = spec({ request: { url: 'http://x/y', headers: { authorization: 'Bearer {{secrets.T}}' }, conditional: { etag: true } } });
    let captured: RequestInit | undefined;
    await runPoller(s, { items: {}, etag: 'E1' }, {
      secrets: { T: 'sekret' },
      fetchImpl: async (_u, init) => {
        captured = init;
        return json([]);
      },
    });
    const headers = captured!.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer sekret');
    expect(headers['if-none-match']).toBe('E1');
  });
});

describe('buildEvent', () => {
  it('映射并校验成信封；非法 URL 被丢弃', () => {
    const s = spec({
      map: {
        type: '"github.pr.reply"',
        text: '$.body',
        title: '"新回复"',
        url: '"not a url"',
        dedup_key: '"pr:1:comment:{{ id }}"',
        data: '$',
      },
    });
    const ev = buildEvent(s, { id: 9, body: 'hi' });
    expect(ev.type).toBe('github.pr.reply');
    expect(ev.text).toBe('hi');
    expect(ev.dedup_key).toBe('pr:1:comment:9');
    expect(ev.url).toBeUndefined();
    expect(ev.data).toEqual({ id: 9, body: 'hi' });
  });
});
