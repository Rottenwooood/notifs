import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syncProducers } from '@notify-hub/producers';
import { Supervisor } from '@notify-hub/supervisor';
import { testStore } from './helpers.ts';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const running: Supervisor[] = [];

afterEach(() => {
  for (const s of running.splice(0)) s.stop();
});

/** 造一个 managed producer：临时目录 + 脚本 + token 文件。 */
function setupProducer(script: string) {
  const dir = mkdtempSync(join(tmpdir(), 'nh-sup-'));
  const dataDir = join(dir, 'data');
  const producersDir = join(dir, 'producers');
  const slug = 'test-proc';
  mkdirSync(join(producersDir, slug), { recursive: true });
  writeFileSync(join(producersDir, slug, 'index.mjs'), script);
  writeFileSync(
    join(producersDir, slug, 'producer.json'),
    JSON.stringify({ name: 'test', slug, kind: 'managed', command: ['node', 'index.mjs'] }),
  );
  const store = testStore();
  syncProducers(store, { producersDir, dataDir });
  const producer = store.getProducerBySlug(slug)!;
  return { store, producerId: producer.id, stateDir: producer.stateDir!, dir };
}

describe('Supervisor 托管（§5.3.2）', () => {
  it('非 0 退出 → 按退避重启，restartCount 持续递增', async () => {
    const { store, producerId } = setupProducer('process.exit(1);');
    const sup = new Supervisor(store, { baseUrl: 'http://x', backoffMs: [20] });
    running.push(sup);
    sup.startProducer(producerId);
    await sleep(300);
    const p = store.getProducerById(producerId)!;
    expect(p.restartCount).toBeGreaterThanOrEqual(2); // 反复重启
    expect(['crashed', 'running']).toContain(p.status);
  });

  it('exit 0 → 正常结束，不重启', async () => {
    const { store, producerId } = setupProducer('process.exit(0);');
    const sup = new Supervisor(store, { baseUrl: 'http://x', backoffMs: [20] });
    running.push(sup);
    sup.startProducer(producerId);
    await sleep(200);
    const p = store.getProducerById(producerId)!;
    expect(p.restartCount).toBe(0);
    expect(p.status).toBe('stopped');
    expect(sup.isRunning(producerId)).toBe(false);
  });

  it('捕获子进程输出并落到 state_dir/hub.log', async () => {
    const { store, producerId, stateDir } = setupProducer(
      'console.log("hello-from-producer"); setInterval(()=>{}, 1000);',
    );
    const sup = new Supervisor(store, { baseUrl: 'http://x' });
    running.push(sup);
    sup.startProducer(producerId);
    await sleep(300);
    expect(sup.logsFor(producerId).join('\n')).toContain('hello-from-producer');
    expect(existsSync(join(stateDir, 'hub.log'))).toBe(true);
    sup.stopProducer(producerId);
    await sleep(50);
  });

  it('心跳超时 → 判定卡死并重启', async () => {
    const { store, producerId } = setupProducer('setInterval(()=>{}, 1000);');
    const sup = new Supervisor(store, { baseUrl: 'http://x', healthTimeoutMs: 50, backoffMs: [20] });
    running.push(sup);
    sup.startProducer(producerId);
    await sleep(100);
    const restarted = sup.handleHealth(Date.now() + 1000);
    expect(restarted).toContain(producerId);
    expect(store.getProducerById(producerId)!.restartCount).toBeGreaterThanOrEqual(1);
    sup.stopProducer(producerId);
    await sleep(50);
  });

  it('禁用后 reconcile 会停掉运行中的程序', async () => {
    const { store, producerId } = setupProducer('setInterval(()=>{}, 1000);');
    const sup = new Supervisor(store, { baseUrl: 'http://x' });
    running.push(sup);
    sup.startProducer(producerId);
    await sleep(150);
    expect(sup.isRunning(producerId)).toBe(true);
    store.setProducerEnabled(producerId, false);
    sup.reconcile();
    await sleep(150);
    expect(sup.isRunning(producerId)).toBe(false);
  });
});
