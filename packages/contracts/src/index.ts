import { z } from 'zod';

/**
 * 事件信封（§5.1）——整个系统的唯一公共语言。
 *
 * 只有 type / text 必填，其余皆可选。未知字段一律拒绝（strict），避免契约漂移。
 */
export const SeveritySchema = z.enum(['info', 'warn', 'critical']);
export type Severity = z.infer<typeof SeveritySchema>;

export const EventInputSchema = z
  .object({
    /** 事件类型，规则匹配的主依据，如 "github.pr.reply" */
    type: z.string().min(1).max(200),
    /** 给人看的提醒正文：可以是一句话，也可以是完整正文 */
    text: z.string().min(1).max(20_000),
    /** 来源标识；不填则用 token 绑定的源 */
    source: z.string().min(1).max(200).optional(),
    /** 通知标题 */
    title: z.string().max(500).optional(),
    /** 主链接，点通知可跳转 */
    url: z.string().url().optional(),
    /** 严重级别，默认 info */
    severity: SeveritySchema.optional(),
    /** 去重键；不填则由中心按 (source,type,text) 派生 */
    dedup_key: z.string().min(1).max(500).optional(),
    /** 事件发生时间（ISO8601）；默认 = 接收时间 */
    at: z.string().datetime({ offset: true }).optional(),
    /** 结构化附加数据，规则/模板可按路径取值 */
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type EventInput = z.infer<typeof EventInputSchema>;

/** 落库后的事件：补齐中心生成的字段与默认值。 */
export interface StoredEvent {
  event_id: string;
  source: string;
  producer_id: string | null;
  type: string;
  text: string;
  title: string | null;
  url: string | null;
  severity: Severity;
  dedup_key: string;
  at: string;
  received_at: string;
  data: Record<string, unknown>;
}

/** 通道渲染后的消息（§5.6.1）。 */
export interface RenderedMessage {
  title: string;
  body: string;
  markdown?: string;
  url?: string;
  severity: Severity;
  event_id: string;
}

export interface SendContext {
  channelId: string;
  channelName: string;
  deliveryId: string;
  attempt: number;
  idempotencyKey: string;
  now: Date;
}

export type SendResult =
  | { ok: true; providerId?: string }
  | { ok: false; retryable: boolean; error: string };

/** 通道契约（§5.6.1）。 */
export interface Channel {
  kind: string;
  validateConfig(cfg: unknown): { ok: true } | { ok: false; error: string };
  send(msg: RenderedMessage, cfg: unknown, ctx: SendContext): Promise<SendResult>;
}

/** 规则（§5.5）。 */
export const RuleWhenSchema = z
  .object({
    source: z.string().optional(),
    type: z.string().optional(),
    all: z.array(z.record(z.string(), z.unknown())).optional(),
    not: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .strict();

export const RuleBehaviorSchema = z
  .object({
    dedup_ttl: z.string().optional(),
    throttle: z.object({ max: z.number().int().positive(), per: z.string() }).strict().optional(),
    quiet: z
      .object({ from: z.string(), to: z.string(), allow: z.array(SeveritySchema).optional() })
      .strict()
      .optional(),
    exclusive: z.boolean().optional(),
  })
  .strict();

export const RuleActionSchema = z
  .object({
    channel: z.string().min(1),
    template: z.string().optional(),
  })
  .strict();

export const RuleSpecSchema = z
  .object({
    name: z.string().min(1),
    enabled: z.boolean().optional(),
    priority: z.number().int().optional(),
    when: RuleWhenSchema,
    behavior: RuleBehaviorSchema.optional(),
    actions: z.array(RuleActionSchema).min(1),
  })
  .strict();

export type RuleSpec = z.infer<typeof RuleSpecSchema>;

/** 默认模板名。 */
export const DEFAULT_TEMPLATE = 'default';
