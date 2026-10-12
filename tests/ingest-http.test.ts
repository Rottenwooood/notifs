import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerChannel } from '@notify-hub/channels';
import type { Channel } from '@notify-hub/contracts';
import { buildServer } from '../apps/server/src/app.ts';
import { OutboxWorker } from '../apps/server/src/worker.ts';
import { testStore } from './helpers.ts';

const received: unknown[] = [];
const nullChannel: Channel = {
  kind: 'null',
  validateConfig: () => ({ ok: true }),
  async send(msg) {
    received.push(msg);
    return { ok: true };
  },
};
registerChannel(nullChannel);

describe('Ingest HTTP 接口（§5.2）', () => {
  let app: ReturnType<typeof buildServer>;
  let store: ReturnType<typeof testStore>;
  let worker: OutboxWorker;
  let token = '';

  beforeAll(async () => {
    store = testStore();
    const created = store.createSource({ name: 'cli' });
    token = created.token;
    store.upsertChannel({ name: 'null', kind: 'null', config: {} });
    store.upsertRule({ name: 'all', when: {}, actions: [{ channel: 'null' }] });
    worker = new OutboxWorker(store, { batch: 10 });
    app = buildServer({ store });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (payload: unknown, t = token) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { authorization: `Bearer ${t}` },
      payload: payload as object,
    });

  it('无 token → 401', async () => {
    const res = await post({ type: 't', text: 'x' }, 'bogus');
    expect(res.statusCode).toBe(401);
  });

  it('合法单条 → 202 并入队投递（worker 送达）', async () => {
    const res = await post({ type: 'demo.hello', text: '你好' });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.accepted).toBe(true);
    expect(body.deduplicated).toBe(false);
    expect(body.event_ids.length).toBe(1);
    expect(body.dispatches).toBe(1);
    expect(store.deliveryStats().pending).toBe(1);

    await worker.tick();
    expect(received.length).toBe(1);
    expect(store.deliveryStats().sent).toBe(1);
  });

  it('重复事件 → deduplicated', async () => {
    await post({ type: 'demo.hello', text: '同一句' });
    const res = await post({ type: 'demo.hello', text: '同一句' });
    expect(res.json().deduplicated).toBe(true);
  });

  it('畸形事件 → 400', async () => {
    const res = await post({ text: '缺少 type' });
    expect(res.statusCode).toBe(400);
  });

  it('批量 → 逐个处理', async () => {
    const res = await post([
      { type: 't', text: 'a' },
      { type: 't', text: 'b' },
      { bogus: true },
    ]);
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.accepted).toBe(2);
    expect(body.errors.length).toBe(1);
  });
});
