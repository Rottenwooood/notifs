import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerAdapter } from '@notify-hub/adapters';
import { KernelHost } from '../apps/server/src/kernel-host.ts';
import { startAdapters } from '../apps/server/src/adapters.ts';
import type { AdapterMessage } from '@notify-hub/contracts';

it('渠道适配器在边缘渲染，完整批次发送后才确认；内核保留原始结构', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'notifs-channel-'));
  const path = join(dir, 'db.sqlite');
  const worker = new KernelHost({ dbPath: path, adminToken: 'admin' });
  const seen: AdapterMessage[] = [];
  const kind = 'local';
  let resolveSent!: () => void;
  const sent = new Promise<void>(resolve => { resolveSent = resolve; });
  registerAdapter({ kind, validateConfig: () => ({ ok: true }), async send(message) { seen.push(message); if (seen.length === 2) resolveSent(); return { ok: true }; } });
  let channels: ReturnType<typeof startAdapters> | undefined;
  const errors: unknown[] = [];
  try {
    const identity = await worker.call<{ token: string }>('identities.create', 'admin', { name: 'sender' });
    await worker.call('endpoints.put', 'admin', { name: 'phone', owner: 'sender', delivery: {kind:'local'} });
    await worker.call('subscriptions.put', 'admin', { name: 'all', endpoint: 'phone' });
    const first = await worker.call<{ id: string }>('publish', identity.token, { message: { type: 'result', content: { nested: [1, '中文'] } } });
    await worker.call('publish', identity.token, { message: { type: 'message', content: 'plain text' } });
    channels = startAdapters(worker, 'admin', err => errors.push(err));
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([sent, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('channel timeout')), 2000); })]).finally(() => clearTimeout(timer));
    // A round-trip through the worker after send observes the adapter's acknowledgement.
    await new Promise<void>(resolve => setImmediate(resolve));
    await expect.poll(async () => {
      const inspected = await worker.call<{ deliveries: { state: string }[] }>('inspect', identity.token, { id: first.id });
      return inspected.deliveries[0]?.state;
    }).toBe('received');
    const result = await worker.call<{ content: unknown }>('inspect', identity.token, { id: first.id });
    expect(result.content).toEqual({ nested: [1, '中文'] });
    expect(seen[0]!.body).toBe(JSON.stringify({ nested: [1, '中文'] }, null, 2));
    expect(seen[1]!.body).toBe('plain text');
    expect(errors).toEqual([]);
  } finally {
    await channels?.stop(); await worker.close(); rmSync(dir, { recursive: true, force: true });
  }
});
