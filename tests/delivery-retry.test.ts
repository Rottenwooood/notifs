import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerAdapter } from '@notify-hub/adapters';
import { KernelHost } from '../apps/server/src/kernel-host.ts';
import { startAdapters } from '../apps/server/src/adapters.ts';

async function withHub(run: (ctx: {
  worker: KernelHost; token: string; messageId: string; errors: unknown[];
}) => Promise<void>, deliver: (attempt: number) => { ok: true } | { ok: false; retryable: boolean; error: string }, kind: string) {
  const dir = mkdtempSync(join(tmpdir(), 'notifs-retry-'));
  const worker = new KernelHost({ dbPath: join(dir, 'db.sqlite'), adminToken: 'admin' });
  // 内核在 worker 线程里校验 kind，所以复用内置的 webhook 类型，在测试进程内替换它的实现。
  registerAdapter({ kind, validateConfig: () => ({ ok: true }), async deliver(_batch, _config, context) { return deliver(context.attempt); } });
  let channels: ReturnType<typeof startAdapters> | undefined;
  const errors: unknown[] = [];
  try {
    const identity = await worker.call<{ token: string }>('identities.create', 'admin', { name: 'sender' });
    await worker.call('endpoints.put', 'admin', { name: 'sink', owner: 'sender', delivery: { kind, config: { url: 'http://127.0.0.1:9/sink' } } });
    await worker.call('subscriptions.put', 'admin', { name: 'all', endpoint: 'sink' });
    const published = await worker.call<{ id: string }>('publish', identity.token, { message: { type: 'job', content: 'go' } });
    channels = startAdapters(worker, 'admin', err => errors.push(err));
    await run({ worker, token: identity.token, messageId: published.id, errors });
  } finally {
    await channels?.stop();
    await worker.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

it('不可重试的适配器错误立即保留为 held，不再空转重试', async () => {
  let attempts = 0;
  await withHub(async ({ worker, token, messageId }) => {
    await expect.poll(async () => {
      const inspected = await worker.call<{ deliveries: { state: string }[] }>('inspect', token, { id: messageId });
      return inspected.deliveries[0]?.state;
    }, { timeout: 5_000 }).toBe('held');
  }, () => { attempts += 1; return { ok: false, retryable: false, error: 'bad config' }; }, 'webhook');
  expect(attempts).toBe(1);
}, 15_000);

it('可重试错误按退避重试，成功后确认', async () => {
  let attempts = 0;
  await withHub(async ({ worker, token, messageId }) => {
    await expect.poll(async () => {
      const inspected = await worker.call<{ deliveries: { state: string }[] }>('inspect', token, { id: messageId });
      return inspected.deliveries[0]?.state;
    }, { timeout: 12_000 }).toBe('received');
  }, attempt => { attempts = attempt; return attempt < 3 ? { ok: false, retryable: true, error: 'network' } : { ok: true }; }, 'webhook');
  expect(attempts).toBe(3);
}, 20_000);
