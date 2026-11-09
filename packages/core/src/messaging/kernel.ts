import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  MessagingError, OperationSchemas, type EndpointSpec, type Json, type MessageInput,
  type PublishOptions, type SubscriptionSpec,
} from '@notify-hub/contracts';
import { MessageStore, sha256, type MessageLimits, type SourceRow } from '@notify-hub/store';
import { MessageRouter } from './router.ts';

/** Single owner of configuration and durable communication state. No network or channel code. */
export class MessagingKernel {
  readonly storage: MessageStore;
  private router: MessageRouter;
  private endpointNames = new Set<string>();
  private adminHash: Buffer;
  constructor(dbPath: string, adminToken: string, limits?: Partial<MessageLimits>) {
    if (!adminToken) throw new Error('管理凭据不能为空');
    this.adminHash = createHash('sha256').update(adminToken).digest();
    this.storage = new MessageStore(dbPath, limits);
    this.router = new MessageRouter([]);
    this.reload();
  }
  private reload(): void {
    this.router = new MessageRouter(this.storage.subscriptions());
    this.endpointNames = new Set(this.storage.endpoints().map(e => e.name));
  }
  close(): void { this.storage.close(); }
  private actor(token: string): { admin: boolean; source?: SourceRow } {
    if (timingSafeEqual(createHash('sha256').update(token).digest(), this.adminHash)) return { admin: true };
    const source = this.storage.store.getSourceByTokenHash(sha256(token));
    if (!source) throw new MessagingError('unauthorized', '无效或缺失的身份凭据', 401);
    if (!source.enabled) throw new MessagingError('disabled', '身份已停用', 403);
    return { admin: false, source };
  }
  private ownEndpoint(actor: { admin: boolean; source?: SourceRow }, name: string): void {
    if (this.storage.endpoint(name).owner_id !== actor.source?.id && !actor.admin) throw new MessagingError('forbidden', '不能领取其他身份的消息', 403);
  }
  execute(operation: string, token: string, raw: unknown = {}, now = Date.now()): unknown {
    const schema = OperationSchemas[operation as keyof typeof OperationSchemas];
    if (!schema) throw new MessagingError('unknown_operation', '未知操作', 400);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new MessagingError('invalid_input', parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
    const actor = this.actor(token);
    if (operation.includes('.') || operation === 'status') {
      if (!actor.admin) throw new MessagingError('forbidden', '此操作需要订阅管理凭据', 403);
    }
    const input = parsed.data as Record<string, unknown>;
    switch (operation) {
      case 'authenticate': return { identity: actor.source?.name ?? 'manager', manager: actor.admin };
      case 'participants.create': {
        const name = input.name as string;
        if (this.storage.store.getSourceByName(name)) throw new MessagingError('conflict', '身份已存在；不会覆盖现有凭据', 409);
        const created = this.storage.store.createSource({ name });
        return { name, token: created.token };
      }
      case 'endpoints.put': {
        const spec = parsed.data as EndpointSpec;
        if (spec.channel && !this.storage.store.getChannelByName(spec.channel)) throw new MessagingError('not_found', '通知渠道不存在', 404);
        this.storage.putEndpoint(spec); this.reload(); return spec;
      }
      case 'endpoints.list': return this.storage.endpoints();
      case 'endpoints.resume': this.storage.resume(input.endpoint as string); return { resumed: true };
      case 'subscriptions.put': {
        const spec = parsed.data as SubscriptionSpec;
        for (const p of spec.all) {
          if (p.op === 'exists' && typeof p.value !== 'boolean') throw new MessagingError('invalid_input', 'exists 条件要求布尔值');
          if (p.op === 'in' && !Array.isArray(p.value)) throw new MessagingError('invalid_input', 'in 条件要求数组');
          if (['gt', 'lt'].includes(p.op) && typeof p.value !== 'number') throw new MessagingError('invalid_input', '数值比较要求数字');
        }
        this.storage.putSubscription(spec); this.reload(); return spec;
      }
      case 'subscriptions.list': return this.storage.subscriptions();
      case 'subscriptions.remove': this.storage.removeSubscription(input.name as string); this.reload(); return { removed: true };
      case 'publish': {
        if (!actor.source) throw new MessagingError('forbidden', '管理凭据不充当消息发送者', 403);
        const message = input.message as MessageInput;
        const options = input.options as PublishOptions;
        if (Buffer.byteLength(JSON.stringify(message)) > 260_000) throw new MessagingError('message_too_large', '单条消息不能超过 260000 字节', 413);
        const clientId = options.id ?? randomUUID();
        const fingerprint = sha256(stable({ message, to: options.to ? [...new Set(options.to)].sort() : null }));
        const existing = this.storage.existing(actor.source.id, clientId, fingerprint);
        if (existing) return existing; // Retries never re-run routing against changed subscriptions.
        const recipients = this.router.route(actor.source.name, message, options.to).filter(n => this.endpointNames.has(n));
        if (recipients.length > 1000) throw new MessagingError('fanout_too_large', '单条消息不能超过 1000 个接收目标', 413);
        return this.storage.publish(actor.source, message, clientId, fingerprint, recipients, now);
      }
      case 'receive': this.ownEndpoint(actor, input.endpoint as string); return this.storage.receive(input.endpoint as string, now);
      case 'ack':
      case 'renew': {
        this.ownEndpoint(actor, this.storage.batchEndpoint(input.id as string));
        return operation === 'ack' ? this.storage.ack(input.id as string, input.lease as string, now) : this.storage.renew(input.id as string, input.lease as string, now);
      }
      case 'inspect': return this.storage.inspect(input.id as string, actor.source?.id ?? '', actor.admin);
      case 'status': return this.storage.status();
    }
  }
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable((value as Record<string, Json>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
