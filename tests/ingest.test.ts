import { describe, expect, it } from 'vitest';
import { ingestOne } from '../apps/server/src/ingest.ts';
import { testStore } from './helpers.ts';
import type { RuleSpec } from '@notify-hub/contracts';

function seed(rule?: RuleSpec) {
  const store = testStore();
  const a = store.createSource({ name: 'github' });
  const b = store.createSource({ name: 'other' });
  store.upsertChannel({ name: 'phone', kind: 'local', config: {} });
  store.upsertChannel({ name: 'team', kind: 'local', config: {} });
  if (rule) store.upsertRule(rule);
  return { store, a, b };
}

describe('接收 + 路由（§5.2 / §5.5）', () => {
  it('派生 dedup_key 并幂等去重', () => {
    const { store, a } = seed();
    const first = ingestOne(a.source, { type: 'demo', text: '同一句话' }, { store });
    const second = ingestOne(a.source, { type: 'demo', text: '同一句话' }, { store });
    expect(first.accepted).toBe(true);
    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.eventId).toBeUndefined();
  });

  it('显式 dedup_key 生效', () => {
    const { store, a } = seed();
    const r1 = ingestOne(a.source, { type: 'demo', text: 'x', dedup_key: 'k1' }, { store });
    const r2 = ingestOne(a.source, { type: 'demo', text: 'y', dedup_key: 'k1' }, { store });
    expect(r1.deduplicated).toBe(false);
    expect(r2.deduplicated).toBe(true);
  });

  it('非法输入被拒绝', () => {
    const { store, a } = seed();
    const r = ingestOne(a.source, { type: 'demo' }, { store });
    expect(r.accepted).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('规则按 source + type glob 命中并产生投递', () => {
    const { store, a } = seed({
      name: 'pr',
      when: { source: 'github', type: 'github.pr.*' },
      actions: [{ channel: 'phone' }, { channel: 'team' }],
    });
    const hit = ingestOne(a.source, { type: 'github.pr.reply', text: 'hi' }, { store });
    expect(hit.dispatches).toBe(2);

    const miss = ingestOne(a.source, { type: 'github.push', text: 'x' }, { store });
    expect(miss.dispatches).toBe(0);
  });

  it('字段谓词 all/not 生效', () => {
    const { store, a } = seed({
      name: 'r',
      when: { all: [{ field: 'data.author', ne: 'me' }], not: [{ field: 'data.draft', eq: true }] },
      actions: [{ channel: 'phone' }],
    });
    expect(
      ingestOne(a.source, { type: 't', text: 'a', data: { author: 'Alice' } }, { store }).dispatches,
    ).toBe(1);
    expect(
      ingestOne(a.source, { type: 't', text: 'b', data: { author: 'me' } }, { store }).dispatches,
    ).toBe(0);
    expect(
      ingestOne(a.source, { type: 't', text: 'c', data: { author: 'Bob', draft: true } }, { store })
        .dispatches,
    ).toBe(0);
  });

  it('exclusive 命中后短路低优先级规则', () => {
    const store = testStore();
    const s = store.createSource({ name: 's' });
    store.upsertChannel({ name: 'c1', kind: 'local', config: {} });
    store.upsertChannel({ name: 'c2', kind: 'local', config: {} });
    store.upsertRule({ name: 'high', priority: 200, behavior: { exclusive: true }, when: {}, actions: [{ channel: 'c1' }] });
    store.upsertRule({ name: 'low', priority: 100, when: {}, actions: [{ channel: 'c2' }] });
    const r = ingestOne(s.source, { type: 't', text: 'x' }, { store });
    expect(r.dispatches).toBe(1);
  });
});
