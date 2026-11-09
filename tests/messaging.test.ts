import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessagingKernel } from '../packages/core/src/messaging/kernel.ts';
import type { MessageBatch, PublishResult } from '@notify-hub/contracts';

const cleanup: (() => void)[] = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });
function setup(limits = {}) {
  const kernel = new MessagingKernel(':memory:', 'admin', limits);
  cleanup.push(() => kernel.close());
  const sender = kernel.execute('participants.create', 'admin', { name: 'sender' }) as { token: string };
  const alice = kernel.execute('participants.create', 'admin', { name: 'alice' }) as { token: string };
  const bob = kernel.execute('participants.create', 'admin', { name: 'bob' }) as { token: string };
  const admin = (operation: string, input = {}) => kernel.execute(operation, 'admin', input);
  const endpoint = (name: string, options = {}) => admin('endpoints.put', { name, owner: name, ...options });
  const subscribe = (name: string, endpoint: string, options = {}) => admin('subscriptions.put', { name, endpoint, ...options });
  const publish = (content: unknown = 'hello', options = {}, now = 1000) => kernel.execute('publish', sender.token, { message: { type: 'message', content }, options }, now) as PublishResult;
  const receive = (name = 'alice', now = 1000) => (kernel.execute('receive', name === 'alice' ? alice.token : bob.token, { endpoint: name }, now) as { batch: MessageBatch | null }).batch;
  return { kernel, sender, alice, bob, admin, endpoint, subscribe, publish, receive };
}

describe('v2 统一消息内核', () => {
  it('正文只有类型与内容；来源不允许自报，原始 JSON 不经通知渲染', () => {
    const f = setup(); f.endpoint('alice'); f.subscribe('all', 'alice');
    for (const message of [{ content: 'x' }, { type: 'x' }, { type: 'x', content: 'x', source: 'admin' }, { type: 'x', content: 'x', caused_by: 'anything' }]) {
      expect(() => f.kernel.execute('publish', f.sender.token, { message })).toThrow();
    }
    const original = { text: '你好', result: [1, null, true], nested: { id: 'a' } };
    const sent = f.publish(original);
    const batch = f.receive()!;
    expect(batch.messages[0]).toEqual({ id: sent.id, type: 'message', content: original, source: 'sender', received_at: new Date(1000).toISOString() });
  });
  it('没有第二类权限规则；只有管理身份能编辑订阅，普通身份只能接收自己的目标', () => {
    const f = setup(); f.endpoint('alice'); f.endpoint('bob'); f.subscribe('all', 'alice'); f.publish();
    expect(() => f.kernel.execute('subscriptions.put', f.alice.token, { name: 'steal', endpoint: 'bob' })).toThrow('管理凭据');
    expect(() => f.kernel.execute('receive', f.bob.token, { endpoint: 'alice' })).toThrow('其他身份');
    expect(() => f.kernel.execute('publish', 'admin', { message: { type: 'x', content: 'x' } })).toThrow('不充当');
    const batch = f.receive()!;
    expect(() => f.kernel.execute('ack', f.bob.token, { id: batch.id, lease: batch.lease }, 1001)).toThrow('其他身份');
  });
  it('多条订阅扇出但同目标只送一份；to 只能缩小订阅结果', () => {
    const f = setup(); f.endpoint('alice'); f.endpoint('bob');
    f.subscribe('a', 'alice'); f.subscribe('duplicate', 'alice'); f.subscribe('b', 'bob');
    expect(f.publish().recipients).toEqual(['alice', 'bob']);
    expect(f.publish('private', { to: ['bob'] }).recipients).toEqual(['bob']);
    expect(() => f.publish('cannot bypass', { to: ['missing'] })).toThrow('没有匹配');
    expect(f.kernel.storage.store.db.prepare('SELECT COUNT(*) AS n FROM message_deliveries').get()).toEqual({ n: 3 });
  });
  it('支持来源、类型和结构化内容条件，不解释任务或角色', () => {
    const f = setup(); f.endpoint('alice');
    f.subscribe('filtered', 'alice', { type: 'test.*', source: 'sender', all: [{ field: 'stats.failed', op: 'gt', value: 0 }] });
    expect(() => f.publish()).toThrow('没有匹配');
    const result = f.kernel.execute('publish', f.sender.token, { message: { type: 'test.failed', content: { stats: { failed: 2 } } } }) as PublishResult;
    expect(result.recipients).toEqual(['alice']);
  });
  it('相同正文可以多次发送；重试复用 ID，内容或目标不同则冲突', () => {
    const f = setup(); f.endpoint('alice'); f.subscribe('all', 'alice');
    expect(f.publish().id).not.toBe(f.publish().id);
    const a = f.publish({ a: 1, b: 2 }, { id: 'stable' });
    expect(f.publish({ b: 2, a: 1 }, { id: 'stable' })).toEqual({ ...a, deduplicated: true });
    expect(() => f.publish('changed', { id: 'stable' })).toThrow('重试标识');
    expect(() => f.publish({ a: 1, b: 2 }, { id: 'stable', to: ['alice'] })).toThrow('重试标识');
  });
  it('订阅变更只影响后续消息，重复发布返回原目标', () => {
    const f = setup(); f.endpoint('alice'); f.endpoint('bob'); f.subscribe('route', 'alice');
    const a = f.publish('one', { id: 'stable' });
    f.subscribe('route', 'bob');
    expect(f.publish('one', { id: 'stable' })).toEqual({ ...a, deduplicated: true });
    expect(f.publish('two').recipients).toEqual(['bob']);
    expect(f.receive()!.messages.map(m => m.content)).toEqual(['one']);
  });
  it('保存消息与全部投递引用在同一事务，扇出中途失败不留下半条责任', () => {
    const f = setup(); f.endpoint('alice'); f.endpoint('bob'); f.subscribe('a', 'alice'); f.subscribe('b', 'bob');
    const db = f.kernel.storage.store.db;
    db.exec("CREATE TRIGGER fail_b BEFORE INSERT ON message_deliveries WHEN NEW.endpoint='bob' BEGIN SELECT RAISE(ABORT, 'injected'); END");
    expect(() => f.publish('atomic', { id: 'retry' })).toThrow('injected');
    expect(db.prepare('SELECT COUNT(*) AS n FROM messages_v2').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM message_deliveries').get()).toEqual({ n: 0 });
    db.exec('DROP TRIGGER fail_b');
    expect(f.publish('atomic', { id: 'retry' }).recipients).toHaveLength(2);
  });
  it('按目标完整攒批，达到条数立即就绪，不混入其他目标', () => {
    const f = setup(); f.endpoint('alice', { max_wait_ms: 100, max_messages: 2 }); f.endpoint('bob');
    f.subscribe('a', 'alice'); f.subscribe('b', 'bob');
    f.publish('一', {}, 1000); expect(f.receive('alice', 1099)).toBeNull();
    f.publish('二', {}, 1001);
    const batch = f.receive('alice', 1001)!;
    expect(batch.messages.map(m => m.content)).toEqual(['一', '二']);
    expect(batch.endpoint).toBe('alice');
    expect(f.receive('bob', 1001)!.messages.map(m => m.content)).toEqual(['一', '二']);
  });
  it('未满批次在最早消息等待时间到期后发送；限频跨批生效', () => {
    const f = setup(); f.endpoint('alice', { max_wait_ms: 100, min_interval_ms: 1000 }); f.subscribe('a', 'alice');
    f.publish('one', {}, 1000); expect(f.receive('alice', 1099)).toBeNull();
    const first = f.receive('alice', 1100)!;
    f.kernel.execute('ack', f.alice.token, { id: first.id, lease: first.lease }, 1101);
    f.publish('two', {}, 1102);
    expect(f.receive('alice', 2099)).toBeNull();
    expect(f.receive('alice', 2100)!.messages[0]!.content).toBe('two');
  });
  it('字节上限拆批且不截断内容', () => {
    const f = setup(); f.endpoint('alice'); f.subscribe('a', 'alice');
    const text = '甲'.repeat(50_000);
    f.publish(text); f.publish(text);
    const batch = f.receive()!;
    expect(batch.messages).toHaveLength(1); expect(batch.messages[0]!.content).toBe(text);
  });
  it('确认以前不推进；租约到期重发固定批次，旧回执不能覆盖新租约', () => {
    const f = setup({ lease_ms: 100 }); f.endpoint('alice'); f.subscribe('a', 'alice');
    f.publish('one'); const old = f.receive()!; f.publish('two');
    expect(f.receive('alice', 1099)).toBeNull();
    const retry = f.receive('alice', 1100)!;
    expect(retry.id).toBe(old.id); expect(retry.messages).toEqual(old.messages); expect(retry.lease).not.toBe(old.lease);
    expect(() => f.kernel.execute('ack', f.alice.token, { id: old.id, lease: old.lease }, 1101)).toThrow('失效');
    f.kernel.execute('ack', f.alice.token, { id: retry.id, lease: retry.lease }, 1101);
    expect(f.kernel.execute('ack', f.alice.token, { id: retry.id, lease: retry.lease }, 1102)).toEqual({ received: true });
    expect(f.receive('alice', 1103)!.messages[0]!.content).toBe('two');
  });
  it('暂停、重试耗尽只保留待处理消息；恢复后顺序不变', () => {
    const f = setup({ lease_ms: 100, max_attempts: 1 }); f.endpoint('alice'); f.subscribe('a', 'alice');
    f.publish('one'); const first = f.receive()!; f.publish('two');
    expect(f.receive('alice', 1100)).toBeNull();
    expect(f.kernel.storage.store.db.prepare('SELECT state FROM message_batches WHERE id=?').get(first.id)).toEqual({ state: 'held' });
    f.admin('endpoints.resume', { endpoint: 'alice' });
    const retry = f.receive('alice', 1101)!; expect(retry.id).toBe(first.id);
    f.kernel.execute('ack', f.alice.token, { id: retry.id, lease: retry.lease }, 1102);
    f.endpoint('alice', { paused: true }); expect(f.receive('alice', 1103)).toBeNull();
    f.endpoint('alice'); expect(f.receive('alice', 1104)!.messages[0]!.content).toBe('two');
  });
  it('容量不足拒绝整次发布，不删未确认消息；确认释放待投递额度', () => {
    const f = setup({ max_pending: 1 }); f.endpoint('alice'); f.subscribe('a', 'alice');
    const one = f.publish('one', { id: 'one' });
    expect(() => f.publish('two', { id: 'two' })).toThrow('上限');
    expect(f.publish('one', { id: 'one' }).id).toBe(one.id);
    const batch = f.receive()!;
    f.kernel.execute('ack', f.alice.token, { id: batch.id, lease: batch.lease }, 1001);
    expect(f.publish('two', { id: 'two' }).deduplicated).toBe(false);
  });
  it('消息仅供发送者和真实接收者查询，接收者看不到其他人的投递', () => {
    const f = setup(); f.endpoint('alice'); f.endpoint('bob'); f.subscribe('a', 'alice');
    const sent = f.publish();
    expect(() => f.kernel.execute('inspect', f.bob.token, { id: sent.id })).toThrow('不存在');
    f.subscribe('b', 'bob'); const both = f.publish();
    const result = f.kernel.execute('inspect', f.alice.token, { id: both.id }) as { deliveries: unknown[] };
    expect(result.deliveries).toEqual([{ endpoint: 'alice', state: 'pending' }]);
  });
  it('文件数据库重开后保留订阅、原消息、固定批次和限频状态', () => {
    const dir = mkdtempSync(join(tmpdir(), 'notifs-kernel-')); cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'db.sqlite');
    let kernel = new MessagingKernel(path, 'admin', { lease_ms: 100 });
    const source = kernel.execute('participants.create', 'admin', { name: 'agent' }) as { token: string };
    kernel.execute('endpoints.put', 'admin', { name: 'agent', owner: 'agent', min_interval_ms: 1000 });
    kernel.execute('subscriptions.put', 'admin', { name: 'all', endpoint: 'agent' });
    kernel.execute('publish', source.token, { message: { type: 'note', content: 'persist' }, options: { id: 'retry' } }, 1000);
    const old = (kernel.execute('receive', source.token, { endpoint: 'agent' }, 1000) as { batch: MessageBatch }).batch;
    kernel.close(); kernel = new MessagingKernel(path, 'admin', { lease_ms: 100 }); cleanup.push(() => kernel.close());
    const next = (kernel.execute('receive', source.token, { endpoint: 'agent' }, 1101) as { batch: MessageBatch }).batch;
    expect(next.id).toBe(old.id); expect(next.messages).toEqual(old.messages);
    expect(kernel.storage.store.db.pragma('synchronous', { simple: true })).toBe(2);
  });
});
