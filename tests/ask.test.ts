import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../apps/server/src/app.ts';
import { testStore } from './helpers.ts';

/**
 * 提问 / 等回复：POST /api/v1/ask 建提问，用户"引用回复"那条消息后，
 * 入站事件里的 data.reply_to（= 出站消息的 provider_id）把回复接到提问上。
 */
describe('ask：等回复', () => {
  let app: ReturnType<typeof buildServer>;
  let store: ReturnType<typeof testStore>;
  let token = '';

  beforeAll(async () => {
    store = testStore();
    token = store.createSource({ name: 'agent' }).token;
    store.upsertChannel({ name: 'desk', kind: 'local', config: {} });
    store.upsertRule({ name: 'all', when: {}, actions: [{ channel: 'desk' }] });
    app = buildServer({ store });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it('完整闭环：建提问 → 引用回复 → 拿到原话', async () => {
    // 1) 提问（timeout 只填合法范围内的值）
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/ask',
      headers: auth(),
      payload: { text: '要不要现在跑实验？', timeout_minutes: 5 },
    });
    expect(created.statusCode).toBe(202);
    const { ask_id, event_id } = created.json() as { ask_id: string; event_id: string };
    expect(ask_id).toBeTruthy();

    // 2) 中心已把通知派发出去（此刻是 pending 投递）
    const delivery = store
      .listDeliveries(10)
      .find((d) => d.eventId === event_id && d.status === 'pending');
    expect(delivery).toBeTruthy();

    // 3) 模拟"飞书发成功"：记下出站消息 id
    store.markSent(delivery!.id, 'om_msg_123', new Date());

    // 4) 还没回复 → pending
    const before = await app.inject({ method: 'GET', url: `/api/v1/ask/${ask_id}`, headers: auth() });
    expect((before.json() as { status: string }).status).toBe('pending');

    // 5) 入站：用户引用回复了那条消息
    const replyRes = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: auth(),
      payload: {
        type: 'feishu.im.message.receive_v1',
        text: '跑吧，先跑小规模',
        data: { reply_to: 'om_msg_123' },
      },
    });
    expect(replyRes.statusCode).toBe(202);

    // 6) 拿到他的原话
    const after = await app.inject({ method: 'GET', url: `/api/v1/ask/${ask_id}`, headers: auth() });
    const body = after.json() as { status: string; reply: string };
    expect(body.status).toBe('answered');
    expect(body.reply).toBe('跑吧，先跑小规模');
  });

  it('没被引用的回复不会误伤别的提问', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/ask',
      headers: auth(),
      payload: { text: '第二条提问', timeout_minutes: 5 },
    });
    const { ask_id } = created.json() as { ask_id: string };

    await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: auth(),
      payload: { type: 'feishu.im.message.receive_v1', text: '随便说句话', data: {} },
    });

    const r = await app.inject({ method: 'GET', url: `/api/v1/ask/${ask_id}`, headers: auth() });
    expect((r.json() as { status: string }).status).toBe('pending');
  });

  it('超时被标成 expired', async () => {
    const expired = store.createAsk({
      sourceId: store.getSourceByName('agent')!.id,
      eventId: store.listEventsForSource(store.getSourceByName('agent')!.id)[0]!.event_id,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const r = await app.inject({ method: 'GET', url: `/api/v1/ask/${expired.id}`, headers: auth() });
    expect((r.json() as { status: string }).status).toBe('expired');
  });

  it('别人拿不到我的提问；timeout 越界会被夹紧', async () => {
    const otherToken = store.createSource({ name: 'other' }).token;
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/ask',
      headers: auth(),
      payload: { text: 'x', timeout_minutes: 9999 },
    });
    const { ask_id, expires_at } = created.json() as { ask_id: string; expires_at: string };
    // 9999 分钟被夹到上限 30
    expect(Date.parse(expires_at) - Date.now()).toBeLessThanOrEqual(30 * 60_000 + 2000);

    const stolen = await app.inject({
      method: 'GET',
      url: `/api/v1/ask/${ask_id}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(stolen.statusCode).toBe(404);
  });
});
