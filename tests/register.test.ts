import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProducerManifestSchema } from '@notify-hub/contracts';
import { syncProducers } from '@notify-hub/producers';
import { testStore } from './helpers.ts';

describe('ProducerManifest 校验', () => {
  it('managed 必须有 command', () => {
    const r = ProducerManifestSchema.safeParse({ name: 'x', slug: 'x', kind: 'managed' });
    expect(r.success).toBe(false);
  });
  it('poller 必须有 poller 配置', () => {
    const r = ProducerManifestSchema.safeParse({ name: 'x', slug: 'x', kind: 'poller' });
    expect(r.success).toBe(false);
  });
  it('拒绝未知字段', () => {
    const r = ProducerManifestSchema.safeParse({
      name: 'x',
      slug: 'x',
      kind: 'managed',
      command: ['node', 'i.mjs'],
      nope: 1,
    });
    expect(r.success).toBe(false);
  });
  it('slug 只能小写字母数字连字符', () => {
    expect(ProducerManifestSchema.safeParse({ name: 'x', slug: 'Bad Slug', kind: 'managed', command: ['x'] }).success).toBe(false);
  });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'nh-prod-'));
  const dataDir = join(dir, 'data');
  const producersDir = join(dir, 'producers');
  return { dir, dataDir, producersDir };
}

function writeManifest(producersDir: string, slug: string, manifest: unknown) {
  mkdirSync(join(producersDir, slug), { recursive: true });
  writeFileSync(join(producersDir, slug, 'producer.json'), JSON.stringify(manifest, null, 2));
}

describe('syncProducers（§5.3 / §5.4）', () => {
  it('登记 managed：建 source + producer，token 落到 state_dir/token', () => {
    const { dataDir, producersDir } = setup();
    writeManifest(producersDir, 'gh', {
      name: 'GitHub',
      slug: 'gh',
      kind: 'managed',
      command: ['node', 'index.mjs'],
    });
    const store = testStore();
    const res = syncProducers(store, { producersDir, dataDir });

    expect(res.errors).toHaveLength(0);
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0]!.action).toBe('created');
    expect(res.entries[0]!.tokenWritten).toBe(true);

    const p = store.getProducerBySlug('gh');
    expect(p?.kind).toBe('managed');
    expect(p?.enabled).toBe(true);
    const tokenFile = join(dataDir, 'producers', 'gh', 'token');
    expect(existsSync(tokenFile)).toBe(true);
    expect(readFileSync(tokenFile, 'utf8').length).toBeGreaterThan(20);
  });

  it('幂等：重复 sync 不新增，且不覆盖用户的启用开关', () => {
    const { dataDir, producersDir } = setup();
    writeManifest(producersDir, 'gh', { name: 'GH', slug: 'gh', kind: 'managed', command: ['node', 'i.mjs'] });
    const store = testStore();
    syncProducers(store, { producersDir, dataDir });
    const before = store.getProducerBySlug('gh')!;
    store.setProducerEnabled(before.id, false);

    const res = syncProducers(store, { producersDir, dataDir });
    expect(res.entries[0]!.action).toBe('updated');
    expect(store.listProducers()).toHaveLength(1);
    expect(store.getProducerBySlug('gh')!.enabled).toBe(false);
  });

  it('manifest.enabled=false 的样板默认不启用', () => {
    const { dataDir, producersDir } = setup();
    writeManifest(producersDir, 'sample', {
      name: 'sample',
      slug: 'sample',
      kind: 'managed',
      command: ['node', 'i.mjs'],
      enabled: false,
    });
    const store = testStore();
    syncProducers(store, { producersDir, dataDir });
    expect(store.getProducerBySlug('sample')!.enabled).toBe(false);
  });

  it('非法 manifest 记入 errors，不影响其它程序', () => {
    const { dataDir, producersDir } = setup();
    writeManifest(producersDir, 'good', { name: 'g', slug: 'good', kind: 'poller', poller: { request: { url: 'http://x/y' }, key: '$.id', change: { on: 'new_item' }, map: { type: '"t"', text: '$.body' } } });
    writeManifest(producersDir, 'bad', { name: 'b', slug: 'bad', kind: 'managed' });
    const store = testStore();
    const res = syncProducers(store, { producersDir, dataDir });
    expect(res.entries.map((e) => e.slug)).toEqual(['good']);
    expect(res.errors.map((e) => e.dir.split('/').pop())).toEqual(['bad']);
  });
});
