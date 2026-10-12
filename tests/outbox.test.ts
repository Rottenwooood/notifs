import { describe, expect, it } from 'vitest';
import { registerChannel } from '@notify-hub/channels';
import type { Channel, RenderedMessage } from '@notify-hub/contracts';
import { OutboxWorker } from '../apps/server/src/worker.ts';
import { testStore } from './helpers.ts';

/** 可控的测试通道：failTimes 次失败后成功。 */
function makeChannel(kind: string, failTimes: number, retryable = true) {
  let n = 0;
  const seen: RenderedMessage[] = [];
  const ch: Channel = {
    kind,
    validateConfig: () => ({ ok: true }),
    async send(msg) {
      seen.push(msg);
      n++;
      if (n <= failTimes) return { ok: false, retryable, error: `fail#${n}` };
      return { ok: true, providerId: 'ok' };
    },
  };
  registerChannel(ch);
  return seen;
}

function enqueue(store: ReturnType<typeof testStore>, kind: string) {
  const src = store.createSource({ name: `s-${kind}-${Math.random()}` });
  const ch = store.upsertChannel({ name: `c-${kind}-${Math.random()}`, kind, config: {} });
  const r = store.enqueueDelivery({
    eventId: (() => {
      store.insertEvent(
        src.source.id,
        {
          event_id: 'e1',
          source: src.source.name,
          producer_id: null,
          type: 't',
          text: 'x',
          title: null,
          url: null,
          severity: 'info',
          dedup_key: 'd1',
          at: new Date().toISOString(),
          received_at: new Date().toISOString(),
          data: {},
        },
        null,
      );
      return 'e1';
    })(),
    ruleId: null,
    channelId: ch.id,
    idempotencyKey: 'k1',
    renderedJson: JSON.stringify({
      title: 'T',
      body: 'B',
      severity: 'info',
      event_id: 'e1',
    }),
  });
  return { deliveryId: r, channelId: ch.id };
}

describe('outbox 投递（§5.6.3）', () => {
  it('成功即标 sent，且消息内容正确落库', async () => {
    const kind = `okch${Math.random()}`;
    const seen = makeChannel(kind, 0);
    const store = testStore();
    const { deliveryId } = enqueue(store, kind);
    const worker = new OutboxWorker(store, { batch: 10, idleMs: 5 });
    await worker.tick();
    expect(store.getDelivery(deliveryId)!.status).toBe('sent');
    expect(seen.length).toBe(1);
    expect(seen[0]!.title).toBe('T');
    expect(seen[0]!.body).toBe('B');
  });

  it('失败按退避重试，最终成功', async () => {
    const kind = `retry${Math.random()}`;
    makeChannel(kind, 2);
    const store = testStore();
    const { deliveryId } = enqueue(store, kind);
    const worker = new OutboxWorker(store, { batch: 10 });

    await worker.tick(new Date());
    expect(store.getDelivery(deliveryId)!.status).toBe('pending');
    expect(store.getDelivery(deliveryId)!.attempts).toBe(1);

    await worker.tick(new Date(Date.now() + 10_000));
    expect(store.getDelivery(deliveryId)!.attempts).toBe(2);

    await worker.tick(new Date(Date.now() + 30_000));
    expect(store.getDelivery(deliveryId)!.status).toBe('sent');
  });

  it('不可重试错误立即进死信', async () => {
    const kind = `perm${Math.random()}`;
    makeChannel(kind, 999, false);
    const store = testStore();
    const { deliveryId } = enqueue(store, kind);
    const worker = new OutboxWorker(store, { batch: 10 });
    await worker.tick();
    expect(store.getDelivery(deliveryId)!.status).toBe('dead');
  });
});

describe('崩溃补发（§5.6.3 / §7）', () => {
  it('卡在 sending 的投递被重置为 pending', () => {
    const kind = `stuck${Math.random()}`;
    makeChannel(kind, 0);
    const store = testStore();
    const { deliveryId } = enqueue(store, kind);
    // 手动置为 sending 且认领时间久远
    store.db
      .prepare(`UPDATE deliveries SET status='sending', claimed_at=? WHERE id=?`)
      .run(new Date(Date.now() - 60 * 60_000).toISOString(), deliveryId);
    const reset = store.resetStuckSending(5 * 60_000);
    expect(reset).toBe(1);
    expect(store.getDelivery(deliveryId)!.status).toBe('pending');
  });
});
