import { describe, expect, it } from 'vitest';
import { EventInputSchema } from '@notify-hub/contracts';

describe('事件信封（§5.1）', () => {
  it('只要求 type 与 text', () => {
    const r = EventInputSchema.safeParse({ type: 'demo.hello', text: '你好' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.severity).toBeUndefined();
      expect(r.data.data).toBeUndefined();
    }
  });

  it('拒绝缺少 text', () => {
    const r = EventInputSchema.safeParse({ type: 'demo.hello' });
    expect(r.success).toBe(false);
  });

  it('拒绝未知字段（strict）', () => {
    const r = EventInputSchema.safeParse({ type: 't', text: 'x', bogus: 1 });
    expect(r.success).toBe(false);
  });

  it('拒绝对话为空的 type/text', () => {
    expect(EventInputSchema.safeParse({ type: '', text: 'x' }).success).toBe(false);
    expect(EventInputSchema.safeParse({ type: 't', text: '' }).success).toBe(false);
  });

  it('接受完整字段', () => {
    const r = EventInputSchema.safeParse({
      type: 'github.pr.reply',
      text: 'Alice: 麻烦补个测试',
      title: 'PR #123 有新回复',
      url: 'https://github.com/o/r/pull/123',
      severity: 'warn',
      dedup_key: 'pr:123:comment:456',
      at: '2026-10-12T03:00:00.000Z',
      data: { repo: 'o/r', pr: 123 },
    });
    expect(r.success).toBe(true);
  });
});
