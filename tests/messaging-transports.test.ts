import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MessagingWorker } from '../apps/server/src/messaging.ts';
import { listenMessagingIPC } from '../apps/server/src/messaging-ipc.ts';
import { FrameDecoder, encodeFrame } from '../packages/core/src/messaging/framing.ts';
import { MessageClient } from '../packages/core/src/messaging/client.ts';
import { buildServer } from '../apps/server/src/app.ts';
import { openStore } from '@notify-hub/store';
import type { MessageBatch } from '@notify-hub/contracts';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'notifs-wire-')); cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'db.sqlite');
  const worker = new MessagingWorker({ dbPath, adminToken: 'admin', limits: { lease_ms: 200 } }); cleanup.push(() => worker.close());
  const participant = await worker.call<{ token: string }>('participants.create', 'admin', { name: 'agent' });
  const other = await worker.call<{ token: string }>('participants.create', 'admin', { name: 'other' });
  await worker.call('endpoints.put', 'admin', { name: 'agent', owner: 'agent' });
  await worker.call('subscriptions.put', 'admin', { name: 'all', endpoint: 'agent' });
  const store = openStore(dbPath); store.migrate(); cleanup.push(() => store.close());
  const app = buildServer({ store, messaging: worker });
  await app.listen({ host: '127.0.0.1', port: 0 }); cleanup.push(() => app.close());
  const address = app.server.address() as { port: number };
  const socketPath = join(dir, 'hub.sock');
  const ipc = await listenMessagingIPC(socketPath, worker); cleanup.push(() => ipc.close());
  const client = (socket: boolean, token = participant.token) => {
    const c = new MessageClient({ token, ...(socket ? { socketPath } : { baseUrl: `http://127.0.0.1:${address.port}` }) });
    cleanup.push(() => c.close()); return c;
  };
  return { worker, participant, other, app, client, socketPath };
}

describe('v2 Worker / HTTP / IPC', () => {
  it('专用 Worker 启动并处理持久命令，关闭时释放连接', async () => {
    const f = await fixture();
    expect(await f.worker.call('authenticate', f.participant.token)).toEqual({ identity: 'agent', manager: false });
    await expect(f.worker.call('status', f.participant.token)).rejects.toMatchObject({ status: 403 });
  });
  for (const ipc of [false, true]) {
    it(`${ipc ? 'IPC' : 'HTTP'}：发布、指定目标、接收、确认使用相同语义`, async () => {
      const f = await fixture(), c = f.client(ipc);
      const sent = await c.send({ type: 'hello', content: { full: ['中文', null, 42] } }, { id: 'stable', to: ['agent'] });
      expect(sent.recipients).toEqual(['agent']);
      const { batch } = await c.receive('agent');
      expect(batch!.messages[0]!.content).toEqual({ full: ['中文', null, 42] });
      expect(await c.ack(batch!)).toEqual({ received: true });
      expect(await c.receive('agent')).toEqual({ batch: null });
      expect((await c.send({ type: 'hello', content: { full: ['中文', null, 42] } }, { id: 'stable', to: ['agent'] })).id).toBe(sent.id);
      const other = f.client(ipc, f.other.token);
      await expect(other.receive('agent')).rejects.toMatchObject({ code: 'forbidden' });
      await expect(c.call('subscriptions.put', { name: 'illegal', endpoint: 'agent' })).rejects.toMatchObject({ code: 'forbidden' });
    });
    it(`${ipc ? 'IPC' : 'HTTP'}：长等待被新提交唤醒，不依赖轮询间隔`, async () => {
      const f = await fixture(), c = f.client(ipc);
      const pending = c.receive('agent', 1000);
      await c.send({ type: 'message', content: 'wake up' });
      expect((await pending).batch!.messages[0]!.content).toBe('wake up');
    });
  }
  it('HTTP 客户端删除订阅不附带空 JSON 请求体', async () => {
    const f = await fixture();
    const manager = f.client(false, 'admin');
    expect(await manager.call('subscriptions.remove', { name: 'all' })).toEqual({ removed: true });
    expect(await manager.call('subscriptions.list')).toEqual([]);
  });
  it('跨传输重试不重新路由，过期租约自动重投原批', async () => {
    const f = await fixture(), http = f.client(false), ipc = f.client(true);
    const sent = await http.send({ type: 'message', content: 'retry' }, { id: 'same' });
    const first = (await http.receive('agent')).batch!;
    expect((await ipc.send({ type: 'message', content: 'retry' }, { id: 'same' })).id).toBe(sent.id);
    const retry = (await ipc.receive('agent', 1000)).batch!;
    expect(retry.id).toBe(first.id); expect(retry.lease).not.toBe(first.lease);
    await expect(http.ack(first)).rejects.toMatchObject({ code: 'stale_lease' });
    await ipc.ack(retry);
  });
  it('取消长等待和关闭服务不留下领取者', async () => {
    const f = await fixture();
    const abort = new AbortController();
    const pending = f.worker.call('receive', f.participant.token, { endpoint: 'agent', wait_ms: 30_000 }, abort.signal);
    abort.abort(); await expect(pending).rejects.toBeDefined();
    const c = f.client(false); await c.send({ type: 'message', content: 'still queued' });
    expect((await c.receive('agent')).batch!.messages).toHaveLength(1);
  });
  it('非 socket 路径和活动 socket 绝不覆盖', async () => {
    const f = await fixture();
    await expect(listenMessagingIPC(f.socketPath, f.worker)).rejects.toThrow('占用');
    const file = `${f.socketPath}.file`; writeFileSync(file, 'keep');
    await expect(listenMessagingIPC(file, f.worker)).rejects.toThrow('拒绝覆盖');
  });
  it('帧解码支持逐字节输入、多个合并帧及超限拒绝', () => {
    const values: unknown[] = []; const decoder = new FrameDecoder();
    const wire = Buffer.concat([encodeFrame({ content: '中文' }), encodeFrame([1, 2])]);
    for (const byte of wire) decoder.push(Buffer.from([byte]), value => values.push(value));
    expect(values).toEqual([{ content: '中文' }, [1, 2]]);
    const bad = Buffer.alloc(4); bad.writeUInt32BE(1_048_577);
    expect(() => new FrameDecoder().push(bad, () => {})).toThrow('长度');
  });
});
