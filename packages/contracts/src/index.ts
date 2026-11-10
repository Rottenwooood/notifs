import { z } from 'zod';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export const JsonValueSchema: z.ZodType<Json> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string(), z.array(JsonValueSchema), z.record(JsonValueSchema),
]));
export const MessageSchema = z.object({ type: z.string().min(1).max(200), content: JsonValueSchema }).strict();
export type MessageInput = z.infer<typeof MessageSchema>;
const name = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,127}$/);
export const PublishOptionsSchema = z.object({
  id: z.string().min(1).max(200).optional(),
  to: z.array(name).min(1).max(100).optional(),
}).strict();
export type PublishOptions = z.infer<typeof PublishOptionsSchema>;
export const EndpointSchema = z.object({
  name, owner: name,
  delivery: z.object({
    kind: z.string().min(1).max(64),
    config: z.record(JsonValueSchema).default({}),
  }).strict(),
  paused: z.boolean().default(false),
  max_wait_ms: z.number().int().min(0).max(60_000).default(0),
  min_interval_ms: z.number().int().min(0).max(3_600_000).default(0),
  max_messages: z.number().int().min(1).max(100).default(32),
  max_bytes: z.number().int().min(262_144).max(1_048_576).default(262_144),
}).strict();
export type EndpointSpec = z.infer<typeof EndpointSchema>;
export const PredicateSchema = z.object({
  field: z.string().min(1).max(200),
  op: z.enum(['eq', 'ne', 'in', 'exists', 'gt', 'lt']),
  value: JsonValueSchema,
}).strict();
export const SubscriptionSchema = z.object({
  name, endpoint: name,
  source: z.string().min(1).max(200).default('*'),
  type: z.string().min(1).max(200).default('*'),
  all: z.array(PredicateSchema).max(32).default([]),
  enabled: z.boolean().default(true),
}).strict();
export type SubscriptionSpec = z.infer<typeof SubscriptionSchema>;
export interface IncomingMessage extends MessageInput {
  id: string;
  source: string;
  received_at: string;
}
export interface MessageBatch {
  id: string;
  endpoint: string;
  lease: string;
  lease_until: number;
  attempt: number;
  messages: IncomingMessage[];
}
export interface PublishResult {
  id: string;
  deduplicated: boolean;
  recipients: string[];
}
export interface MessagingErrorData { code: string; message: string; status: number }
export interface KernelCall { operation: string; token: string; input?: unknown }
export interface MessagingService {
  call<T = unknown>(operation: string, token: string, input?: unknown, signal?: AbortSignal): Promise<T>;
  close(): Promise<void>;
}
export class MessagingError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
const empty = z.object({}).strict();
export const OperationSchemas = {
  authenticate: empty,
  publish: z.object({ message: MessageSchema, options: PublishOptionsSchema.default({}) }).strict(),
  'delivery.claim': z.object({ endpoint: name, wait_ms: z.number().int().min(0).max(30_000).default(0) }).strict(),
  'delivery.ack': z.object({ id: z.string().uuid(), lease: z.string().uuid() }).strict(),
  'delivery.renew': z.object({ id: z.string().uuid(), lease: z.string().uuid() }).strict(),
  inspect: z.object({ id: z.string().uuid() }).strict(),
  'identities.create': z.object({ name, manager: z.boolean().default(false) }).strict(),
  'identities.list': empty,
  'identities.rotate': z.object({ name }).strict(),
  'identities.enable': z.object({ name, enabled: z.boolean() }).strict(),
  'endpoints.put': EndpointSchema,
  'endpoints.list': empty,
  'endpoints.resume': z.object({ endpoint: name }).strict(),
  'subscriptions.put': SubscriptionSchema,
  'subscriptions.list': empty,
  'subscriptions.remove': z.object({ name }).strict(),
  'maintenance.prune': z.object({
    before: z.number().int().nonnegative(),
    limit: z.number().int().min(1).max(10_000).default(1000),
  }).strict(),
  status: empty,
} as const;

/** Adapter rendering is private to human-facing destinations, not a message envelope. */
export interface AdapterMessage {
  title: string;
  body: string;
  markdown?: string;
  url?: string;
  severity: 'info' | 'warn' | 'critical';
  message_id: string;
}
export interface SendContext {
  endpoint: string;
  deliveryId: string;
  attempt: number;
  idempotencyKey: string;
  now: Date;
  signal?: AbortSignal;
  resolveSecret(name: string): string | undefined;
}
/** Every destination receives the same complete batch; it decides how to render it. */
export interface DeliveryContext {
  endpoint: string;
  batchId: string;
  attempt: number;
  now: Date;
  signal?: AbortSignal;
  resolveSecret(name: string): string | undefined;
}
export interface DeliveryAdapter {
  kind: string;
  validateConfig(config: unknown): { ok: true } | { ok: false; error: string };
  deliver(batch: MessageBatch, config: unknown, context: DeliveryContext): Promise<SendResult>;
}
export type SendResult = { ok: true; providerId?: string } | { ok: false; retryable: boolean; error: string };
export interface OutboundAdapter {
  kind: string;
  validateConfig(config: unknown): { ok: true } | { ok: false; error: string };
  send(message: AdapterMessage, config: unknown, context: SendContext): Promise<SendResult>;
}
