import { EventInputSchema, type EventInput, type StoredEvent } from '@notify-hub/contracts';
import { planDispatch, type TemplateSpec } from '@notify-hub/core';
import { sha256, type ChannelRow, type RuleRow, type SourceRow, type Store } from '@notify-hub/store';
import { ulid } from 'ulid';

export interface IngestOutcome {
  accepted: boolean;
  deduplicated: boolean;
  eventId?: string;
  dispatches: number;
  error?: string;
}

const iso = (d: Date) => d.toISOString();

/** 把一条输入解析成落库事件（补齐中心生成的字段与默认值，§5.2 步骤 3）。 */
export function normalizeEvent(input: EventInput, source: SourceRow, now = new Date()): StoredEvent {
  const severity = input.severity ?? 'info';
  const dedupKey =
    input.dedup_key ?? sha256(`${source.name}|${input.type}|${input.text}`).slice(0, 32);
  return {
    event_id: ulid(),
    source: source.name,
    producer_id: null,
    type: input.type,
    text: input.text,
    title: input.title ?? null,
    url: input.url ?? null,
    severity,
    dedup_key: dedupKey,
    at: input.at ?? iso(now),
    received_at: iso(now),
    data: input.data ?? {},
  };
}

export interface IngestDeps {
  store: Store;
  now?: () => Date;
  templates?: Map<string, TemplateSpec>;
}

/**
 * 接收一条事件：校验 → 幂等预检 → 落库 → 规则评估 → 入 outbox（§5.2）。
 * 返回处理结果；不抛出（调用方按 outcome.accepted 决定 HTTP 码）。
 */
export function ingestOne(source: SourceRow, raw: unknown, deps: IngestDeps): IngestOutcome {
  const { store } = deps;
  const now = deps.now?.() ?? new Date();

  const parsed = EventInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { accepted: false, deduplicated: false, dispatches: 0, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  }
  const input = parsed.data;
  const event = normalizeEvent(input, source, now);

  // 幂等预检
  const existing = store.findActiveDedup(source.id, event.dedup_key, now);
  if (existing) {
    return { accepted: true, deduplicated: true, dispatches: 0 };
  }

  const dedupExpiresAt =
    source.dedupTtlSec > 0 ? iso(new Date(now.getTime() + source.dedupTtlSec * 1000)) : null;

  store.insertEvent(source.id, event, dedupExpiresAt);

  // 回复 → 关联到未决提问：入站事件带 data.reply_to（飞书的 parent_id），
  // 它等于出站消息的 provider_id，能反查到原事件。
  const replyTo = event.data['reply_to'];
  if (typeof replyTo === 'string' && replyTo) {
    const originalEventId = store.findEventIdByProviderId(replyTo);
    if (originalEventId) store.answerAskByEvent(originalEventId, event.text, now);
  }

  const dispatches = dispatchEvent(event, deps);
  return { accepted: true, deduplicated: false, eventId: event.event_id, dispatches };
}

/** 规则评估 → 写投递任务（§5.5）。 */
export function dispatchEvent(event: StoredEvent, deps: IngestDeps): number {
  const { store } = deps;
  const rules: RuleRow[] = store.listEnabledRules();
  if (rules.length === 0) return 0;
  const channels = store.listChannels();
  const byName = new Map<string, ChannelRow>(channels.map((c) => [c.name, c]));
  const byId = new Map<string, ChannelRow>(channels.map((c) => [c.id, c]));
  const plans = planDispatch(event, rules, { byName, byId }, deps.templates);
  for (const plan of plans) {
    store.enqueueDelivery({
      eventId: event.event_id,
      ruleId: plan.ruleId,
      channelId: plan.channel.id,
      idempotencyKey: plan.idempotencyKey,
      renderedJson: JSON.stringify(plan.rendered),
    });
  }
  return plans.length;
}
