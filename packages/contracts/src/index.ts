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
  /** 按名从加密密钥库/环境解析凭据（出口配置里只写名字，不写明文）。 */
  resolveSecret: (name: string) => string | undefined;
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

// ---------------------------------------------------------------- producers

/** Poller 声明式配置（§5.3.3）。 */
export const PollerSpecSchema = z
  .object({
    interval: z.string().min(1).default('60s'),
    request: z
      .object({
        url: z.string().url(),
        method: z.enum(['GET', 'POST']).default('GET'),
        headers: z.record(z.string(), z.string()).optional(),
        body: z.unknown().optional(),
        conditional: z
          .object({ etag: z.boolean().optional(), lastModified: z.boolean().optional() })
          .strict()
          .optional(),
      })
      .strict(),
    extract: z.string().default('$[*]'),
    key: z.string().min(1),
    change: z
      .object({
        on: z.enum(['new_item', 'field_changed', 'threshold']),
        field: z.string().optional(),
        op: z.enum(['gt', 'gte', 'lt', 'lte', 'ne', 'eq']).optional(),
        value: z.number().optional(),
      })
      .strict(),
    map: z.record(z.string(), z.string()),
  })
  .strict();
export type PollerSpec = z.infer<typeof PollerSpecSchema>;

/** 监控程序清单（producer.json）。手写与 agent 生成共用同一种格式（§5.4）。 */
export const ProducerManifestSchema = z
  .object({
    name: z.string().min(1),
    slug: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug 只能是小写字母/数字/连字符'),
    kind: z.enum(['managed', 'poller']),
    description: z.string().optional(),
    interval: z.string().optional(),
    /** 首次登记时是否启用；默认 true。样板程序可设 false 以免未配置就跑起来 */
    enabled: z.boolean().optional(),
    /** 声明需要的凭据名（运行时注入，agent 看不到明文） */
    credentials: z.array(z.string()).optional(),
    /** 程序自定义配置，原样通过 NOTIFY_CONFIG 注入 */
    config: z.record(z.string(), z.unknown()).optional(),
    /** managed：启动命令，如 ["node", "index.mjs"] */
    command: z.array(z.string()).optional(),
    /** poller：声明式轮询配置 */
    poller: PollerSpecSchema.optional(),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (m.kind === 'managed' && (!m.command || m.command.length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'managed 必须提供 command', path: ['command'] });
    }
    if (m.kind === 'poller' && !m.poller) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'poller 必须提供 poller 配置', path: ['poller'] });
    }
  });
export type ProducerManifest = z.infer<typeof ProducerManifestSchema>;

export { PRODUCER_PROTOCOL } from './protocol.ts';
