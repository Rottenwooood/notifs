import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../apps/server/src/app.ts';
import { testStore } from './helpers.ts';

/**
 * agent 只读接口（GET /api/v1/events|deliveries|status）—— MCP 的依赖面。
 * 关键词：用 source token 鉴权；只能看到自己这个源的东西。
 */
describe('agent 只读接口', () => {
  let app: ReturnType<typeof buildServer>;
  let store: ReturnType<typeof testStore>;
  let token = '';
  let otherToken = '';

  beforeAll(async () => {
    store = testStore();
    token = store.createSource({ name: 'agent' }).token;
    otherToken = store.createSource({ name: 'other' }).token;
    app = buildServer({ store });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (payload: Record<string, unknown>, t: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { authorization: `Bearer ${t}` },
      payload,
    });

  const get = (url: string, t?: string) =>
    app.inject({ method: 'GET', url, headers: t ? { authorization: `Bearer ${t}` } : {} });

  it('没有 token 一律 401', async () => {
    expect((await get('/api/v1/events')).statusCode).toBe(401);
    expect((await get('/api/v1/deliveries')).statusCode).toBe(401);
    expect((await get('/api/v1/status')).statusCode).toBe(401);
  });

  it('只能看到自己这个源的事件', async () => {
    await post({ type: 'agent.thing', text: '这是我的' }, token);
    await post({ type: 'other.thing', text: '这是别人的' }, otherToken);

    const mine = (await get('/api/v1/events', token)).json() as {
      events: { type: string; text: string }[];
    };
    expect(mine.events).toHaveLength(1);
    expect(mine.events[0]!.type).toBe('agent.thing');

    const theirs = (await get('/api/v1/events', otherToken)).json() as {
      events: { type: string }[];
    };
    expect(theirs.events.map((e) => e.type)).toEqual(['other.thing']);
  });

  it('type 过滤与 limit 校验', async () => {
    await post({ type: 'agent.next', text: '第二条' }, token);
    const filtered = (await get('/api/v1/events?type=agent.next', token)).json() as {
      events: { type: string }[];
    };
    expect(filtered.events.map((e) => e.type)).toEqual(['agent.next']);
    expect((await get('/api/v1/events?limit=0', token)).statusCode).toBe(400);
    expect((await get('/api/v1/deliveries?status=nope', token)).statusCode).toBe(400);
  });

  it('status 返回出口/规则/程序概览，且不泄露 token', async () => {
    store.upsertChannel({ name: 'desktop', kind: 'local', config: {} });
    const body = (await get('/api/v1/status', token)).json() as Record<string, unknown>;
    expect((body.source as { name: string }).name).toBe('agent');
    expect(JSON.stringify(body)).not.toContain(token);
    expect(Array.isArray(body.channels)).toBe(true);
    expect(body.deliveries).toBeTruthy();
  });
});
