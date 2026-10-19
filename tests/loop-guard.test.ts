import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../apps/server/src/app.ts';
import { testStore } from './helpers.ts';

/**
 * 防回声：入站消息（带 data.chat_id）不能被广播回它来的那个会话。
 * 否则群里的每条消息都会被 bot 复述一遍。
 */
describe('防回声', () => {
  let app: ReturnType<typeof buildServer>;
  let store: ReturnType<typeof testStore>;
  let token = '';

  beforeAll(async () => {
    store = testStore();
    token = store.createSource({ name: 'feishu-events' }).token;
    store.upsertChannel({
      name: 'group',
      kind: 'feishu-app',
      config: { receiveId: 'oc_origin', receiveIdType: 'chat_id' },
    });
    store.upsertChannel({ name: 'desk', kind: 'local', config: {} });
    store.upsertRule({ name: 'all', when: {}, actions: [{ channel: 'group' }, { channel: 'desk' }] });
    app = buildServer({ store });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

  it('来自该会话的消息：不回声，但别的出口照常', async () => {
    const res = await post({
      type: 'feishu.im.message.receive_v1',
      text: '我自己的备忘录',
      data: { chat_id: 'oc_origin' },
    });
    const body = res.json() as { dispatches: number };
    expect(body.dispatches).toBe(1); // 只剩 desk，group 被跳过
    const delivery = store.listDeliveries(5)[0]!;
    expect(delivery.channelId).toBe(store.listChannels().find((c) => c.name === 'desk')!.id);
  });

  it('来自别的会话：正常发到该出口', async () => {
    const res = await post({
      type: 'feishu.im.message.receive_v1',
      text: '另一个群的消息',
      data: { chat_id: 'oc_somewhere_else' },
    });
    expect((res.json() as { dispatches: number }).dispatches).toBe(2);
  });

  it('不是入站消息（没有 chat_id）：全部照发', async () => {
    const res = await post({ type: 'experiment.finished', text: '跑完了' });
    expect((res.json() as { dispatches: number }).dispatches).toBe(2);
  });
});
