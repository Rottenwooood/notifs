import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { HUB_SCHEMA } from './schema.ts';
import type { Statement } from 'better-sqlite3';
import {
  MessagingError, type EndpointSpec, type IncomingMessage, type MessageBatch,
  type MessageInput, type PublishResult, type SubscriptionSpec,
} from '@notify-hub/contracts';
export interface Identity { id: string; name: string; tokenHash: string; manager: boolean; enabled: boolean }
export const sha256 = (input: string) => createHash('sha256').update(input).digest('hex');

export interface MessageLimits {
  max_pending: number;
  max_stored_bytes: number;
  lease_ms: number;
  max_attempts: number;
}
export const DEFAULT_MESSAGE_LIMITS: MessageLimits = {
  max_pending: 100_000, max_stored_bytes: 512 * 1024 * 1024, lease_ms: 30_000, max_attempts: 20,
};

/** SQLite online backup; safe while the center is running. */
export async function backupDatabase(path: string, target: string): Promise<void> {
  const db = new Database(path, { readonly: true });
  try { await db.backup(target); } finally { db.close(); }
  chmodSync(target, 0o600);
}
/** Owns the entire durable operation. Used only by the kernel's writer thread. */
export class MessageStore {
  readonly db: Database.Database;
  readonly limits: MessageLimits;
  private statements = new Map<string, Statement>();
  constructor(path: string, limits: Partial<MessageLimits> = {}) {
    this.limits = { ...DEFAULT_MESSAGE_LIMITS, ...limits };
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path);
    try {
      const tables = (this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name: string}[]).map(t => t.name);
      if (tables.length && (!tables.includes('identities') || tables.includes('sources'))) throw new Error('旧数据库不属于统一通信内核；请设置新的 NOTIFS_DATA_DIR。原库未修改。');
      if ((this.db.pragma('user_version', { simple: true }) as number) > 1) throw new Error('数据库版本高于当前程序');
      this.db.pragma('journal_mode = WAL'); this.db.pragma('foreign_keys = ON');
      this.db.pragma('busy_timeout = 5000'); this.db.pragma('synchronous = FULL');
      if (!tables.length) this.db.transaction(() => { this.db.exec(HUB_SCHEMA); this.db.pragma('user_version = 1'); })();
    } catch (err) { this.db.close(); throw err; }
  }

  ensureController(token: string): void {
    const old = this.identityById('controller');
    if (old) {
      if (old.tokenHash !== sha256(token)) throw new Error('控制者凭据与数据库不匹配；不会静默轮换');
      return;
    }
    this.sql('INSERT INTO identities(id,name,token_hash,manager) VALUES(?,?,?,1)').run('controller', 'owner', sha256(token));
  }
  private identity(row: unknown): Identity | undefined {
    if (!row) return;
    const r = row as {id: string; name: string; token_hash: string; manager: number; enabled: number};
    return { id: r.id, name: r.name, tokenHash: r.token_hash, manager: !!r.manager, enabled: !!r.enabled };
  }
  identityByName(name: string): Identity | undefined { return this.identity(this.sql('SELECT * FROM identities WHERE name=?').get(name)); }
  identityById(id: string): Identity | undefined { return this.identity(this.sql('SELECT * FROM identities WHERE id=?').get(id)); }
  identityByToken(token: string): Identity | undefined { return this.identity(this.sql('SELECT * FROM identities WHERE token_hash=?').get(sha256(token))); }
  identities(): Omit<Identity,'tokenHash'>[] {
    return (this.sql('SELECT * FROM identities ORDER BY name').all()).map(r => { const {tokenHash, ...visible} = this.identity(r)!; return visible; });
  }
  createIdentity(name: string, manager: boolean): {name: string; token: string; manager: boolean} {
    if (this.identityByName(name)) throw new MessagingError('conflict', '身份已存在；不会覆盖已有凭据', 409);
    const token = randomBytes(32).toString('base64url');
    this.sql('INSERT INTO identities(id,name,token_hash,manager) VALUES(?,?,?,?)').run(randomUUID(), name, sha256(token), manager ? 1 : 0);
    return { name, token, manager };
  }
  rotateIdentity(name: string): {name: string; token: string} {
    const identity = this.identityByName(name);
    if (!identity) throw new MessagingError('not_found', '身份不存在', 404);
    if (identity.id === 'controller') throw new MessagingError('conflict', '根控制者凭据由 controller-token 文件维护', 409);
    const token = randomBytes(32).toString('base64url');
    this.sql('UPDATE identities SET token_hash=? WHERE id=?').run(sha256(token), identity.id);
    return {name, token};
  }
  enableIdentity(name: string, enabled: boolean): void {
    const identity = this.identityByName(name);
    if (!identity) throw new MessagingError('not_found', '身份不存在', 404);
    if (identity.id === 'controller') throw new MessagingError('conflict', '不能停用根控制者', 409);
    this.sql('UPDATE identities SET enabled=? WHERE id=?').run(enabled ? 1 : 0, identity.id);
  }

  private sql(text: string): Statement {
    let s = this.statements.get(text);
    if (!s) { s = this.db.prepare(text); this.statements.set(text, s); }
    return s;
  }
  private transaction<T>(fn: () => T): T { return this.db.transaction(fn).immediate(); }
  close(): void { this.db.close(); }
  endpoint(name: string): { owner_id: string; spec: EndpointSpec; next_send_at: number } {
    const row = this.sql('SELECT * FROM endpoints WHERE name=?').get(name) as { owner_id: string; spec: string; next_send_at: number } | undefined;
    if (!row) throw new MessagingError('not_found', '接收目标不存在', 404);
    return { ...row, spec: JSON.parse(row.spec) as EndpointSpec };
  }
  endpoints(): EndpointSpec[] {
    return (this.sql('SELECT spec FROM endpoints ORDER BY name').all() as { spec: string }[]).map(r => JSON.parse(r.spec) as EndpointSpec);
  }
  subscriptions(): SubscriptionSpec[] {
    return (this.sql('SELECT spec FROM subscriptions ORDER BY name').all() as { spec: string }[]).map(r => JSON.parse(r.spec) as SubscriptionSpec);
  }
  putEndpoint(spec: EndpointSpec): void {
    this.transaction(() => {
      const owner = this.identityByName(spec.owner);
      if (!owner) throw new MessagingError('not_found', '接收目标的所属身份不存在', 404);
      const old = this.sql('SELECT owner_id,spec FROM endpoints WHERE name=?').get(spec.name) as { owner_id: string; spec: string } | undefined;
      if (old && old.owner_id !== owner.id) throw new MessagingError('conflict', '已有接收目标不能转交给其他身份', 409);
      if (old && JSON.stringify((JSON.parse(old.spec) as EndpointSpec).delivery) !== JSON.stringify(spec.delivery) && this.sql("SELECT 1 FROM deliveries WHERE endpoint=? AND state!='received' LIMIT 1").get(spec.name)) throw new MessagingError('conflict', '尚有未接管消息，先排空或暂停处理后再更换投递方式', 409);
      this.sql(`INSERT INTO endpoints(name,owner_id,spec) VALUES(?,?,?)
        ON CONFLICT(name) DO UPDATE SET spec=excluded.spec`).run(spec.name, owner.id, JSON.stringify(spec));
      this.sql('UPDATE hub_state SET revision=revision+1 WHERE id=1').run();
    });
  }
  putSubscription(spec: SubscriptionSpec): void {
    this.transaction(() => {
      this.endpoint(spec.endpoint);
      this.sql(`INSERT INTO subscriptions(name,endpoint,spec) VALUES(?,?,?)
        ON CONFLICT(name) DO UPDATE SET endpoint=excluded.endpoint,spec=excluded.spec`).run(spec.name, spec.endpoint, JSON.stringify(spec));
      this.sql('UPDATE hub_state SET revision=revision+1 WHERE id=1').run();
    });
  }
  removeSubscription(name: string): void {
    this.transaction(() => {
      this.sql('DELETE FROM subscriptions WHERE name=?').run(name);
      this.sql('UPDATE hub_state SET revision=revision+1 WHERE id=1').run();
    });
  }
  existing(sourceId: string, clientId: string, fingerprint: string): PublishResult | undefined {
    const row = this.sql('SELECT id,fingerprint,recipients FROM messages WHERE source_id=? AND client_id=?').get(sourceId, clientId) as { id: string; fingerprint: string; recipients: string } | undefined;
    if (!row) return;
    if (row.fingerprint !== fingerprint) throw new MessagingError('idempotency_conflict', '同一重试标识不能用于不同消息或目标', 409);
    return { id: row.id, deduplicated: true, recipients: JSON.parse(row.recipients) as string[] };
  }
  publish(source: Identity, input: MessageInput, clientId: string, fingerprint: string, recipients: string[], now: number): PublishResult {
    const content = JSON.stringify(input.content);
    const id = randomUUID();
    const bytes = Buffer.byteLength(JSON.stringify({ id, type: input.type, content: input.content, source: source.name, received_at: new Date(now).toISOString() }));
    return this.transaction(() => {
      const existing = this.existing(source.id, clientId, fingerprint);
      if (existing) return existing;
      if (!recipients.length) throw new MessagingError('unrouted', '没有匹配的订阅；消息未被接受', 422);
      const counts = this.sql('SELECT pending,stored_bytes FROM hub_state WHERE id=1').get() as { pending: number; stored_bytes: number };
      if (counts.pending + recipients.length > this.limits.max_pending || counts.stored_bytes + bytes > this.limits.max_stored_bytes) {
        throw new MessagingError('overloaded', '队列或存储已达上限；请保留消息并稍后重试', 429);
      }
      const inserted = this.sql(`INSERT INTO messages(id,source_id,client_id,fingerprint,type,content,received_at,bytes,recipients)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(id, source.id, clientId, fingerprint, input.type, content, now, bytes, JSON.stringify(recipients));
      for (const endpoint of recipients) this.sql("INSERT INTO deliveries(message_id,message_seq,endpoint,state) VALUES(?,?,?,'pending')").run(id, inserted.lastInsertRowid, endpoint);
      this.sql('UPDATE hub_state SET pending=pending+?,stored_bytes=stored_bytes+? WHERE id=1').run(recipients.length, bytes);
      return { id, recipients, deduplicated: false };
    });
  }
  /** Fixed batches, one unacknowledged batch per target. An expired lease gets a new token. */
  receive(endpoint: string, now: number): { batch: MessageBatch | null; next_at?: number } {
    return this.transaction(() => {
      const target = this.endpoint(endpoint);
      if (target.spec.paused) return { batch: null };
      const owner = this.identityById(target.owner_id);
      if (!owner?.enabled) return { batch: null };
      const old = this.sql("SELECT * FROM batches WHERE endpoint=? AND state!='received'").get(endpoint) as BatchRow | undefined;
      if (old) {
        if (old.state === 'held') return { batch: null };
        if (old.lease_until > now) return { batch: null, next_at: old.lease_until };
        if (old.attempts >= this.limits.max_attempts) {
          this.sql("UPDATE batches SET state='held' WHERE id=?").run(old.id);
          this.sql("UPDATE deliveries SET state='held' WHERE batch_id=? AND state!='received'").run(old.id);
          return { batch: null };
        }
        const lease = randomUUID(), until = now + this.limits.lease_ms;
        this.sql('UPDATE batches SET lease=?,lease_until=?,attempts=attempts+1 WHERE id=?').run(lease, until, old.id);
        return { batch: this.batch({ ...old, lease, lease_until: until, attempts: old.attempts + 1 }) };
      }
      const rows = this.sql(`SELECT m.* FROM deliveries d JOIN messages m ON m.id=d.message_id
        WHERE d.endpoint=? AND d.state='pending' ORDER BY d.message_seq LIMIT ?`).all(endpoint, target.spec.max_messages + 1) as MessageRow[];
      if (!rows.length) return { batch: null };
      const chosen: MessageRow[] = [];
      let bytes = 0;
      for (const row of rows) {
        if (chosen.length >= target.spec.max_messages || bytes + row.bytes > target.spec.max_bytes - 1024) break;
        chosen.push(row); bytes += row.bytes;
      }
      if (!chosen.length) throw new MessagingError('message_too_large', '队首消息超过接收能力', 413);
      const full = chosen.length >= target.spec.max_messages || chosen.length < rows.length || bytes >= target.spec.max_bytes - 1024;
      const due = Math.max(target.next_send_at, full ? 0 : rows[0]!.received_at + target.spec.max_wait_ms);
      if (now < due) return { batch: null, next_at: due };
      const batch: BatchRow = { id: randomUUID(), endpoint, state: 'leased', lease: randomUUID(), lease_until: now + this.limits.lease_ms, attempts: 1 };
      this.sql("INSERT INTO batches(id,endpoint,state,lease,lease_until) VALUES(?,?,'leased',?,?)").run(batch.id, endpoint, batch.lease, batch.lease_until);
      for (const row of chosen) this.sql("UPDATE deliveries SET state='leased',batch_id=? WHERE endpoint=? AND message_id=?").run(batch.id, endpoint, row.id);
      this.sql('UPDATE endpoints SET next_send_at=? WHERE name=?').run(now + target.spec.min_interval_ms, endpoint);
      return { batch: this.batch(batch) };
    });
  }
  private batch(row: BatchRow): MessageBatch {
    const rows = this.sql(`SELECT m.*,s.name AS source FROM deliveries d JOIN messages m ON m.id=d.message_id
      JOIN identities s ON s.id=m.source_id WHERE d.batch_id=? ORDER BY m.seq`).all(row.id) as (MessageRow & { source: string })[];
    return {
      id: row.id, endpoint: row.endpoint, lease: row.lease, lease_until: row.lease_until, attempt: row.attempts,
      messages: rows.map(m => ({ id: m.id, type: m.type, content: JSON.parse(m.content), source: m.source, received_at: new Date(m.received_at).toISOString() })),
    };
  }
  batchEndpoint(id: string): string {
    const row = this.sql('SELECT endpoint FROM batches WHERE id=?').get(id) as { endpoint: string } | undefined;
    if (!row) throw new MessagingError('not_found', '批次不存在', 404);
    return row.endpoint;
  }
  ack(id: string, lease: string, now: number): { received: true } {
    return this.transaction(() => {
      const row = this.sql('SELECT * FROM batches WHERE id=?').get(id) as BatchRow | undefined;
      if (!row) throw new MessagingError('not_found', '批次不存在', 404);
      if (row.lease !== lease) throw new MessagingError('stale_lease', '交付租约已失效', 409);
      if (row.state === 'received') return { received: true };
      if (row.state !== 'leased' || row.lease_until <= now) throw new MessagingError('stale_lease', '交付租约已失效', 409);
      const changed = this.sql("UPDATE deliveries SET state='received' WHERE batch_id=? AND state!='received'").run(id).changes;
      this.sql("UPDATE batches SET state='received' WHERE id=?").run(id);
      this.sql('UPDATE hub_state SET pending=pending-? WHERE id=1').run(changed);
      return { received: true };
    });
  }
  renew(id: string, lease: string, now: number): { lease_until: number } {
    const until = now + this.limits.lease_ms;
    if (!this.sql("UPDATE batches SET lease_until=? WHERE id=? AND lease=? AND state='leased' AND lease_until>?").run(until, id, lease, now).changes) {
      throw new MessagingError('stale_lease', '交付租约已失效', 409);
    }
    return { lease_until: until };
  }
  /** 不可重试的投递失败：立即把批次保留为 held，等待 resume，不再消耗重试次数。 */
  fail(id: string, lease: string, now: number): { held: true } {
    return this.transaction(() => {
      const row = this.sql('SELECT * FROM batches WHERE id=?').get(id) as BatchRow | undefined;
      if (!row) throw new MessagingError('not_found', '批次不存在', 404);
      if (row.lease !== lease) throw new MessagingError('stale_lease', '交付租约已失效', 409);
      if (row.state === 'held') return { held: true };
      if (row.state !== 'leased' || row.lease_until <= now) throw new MessagingError('stale_lease', '交付租约已失效', 409);
      this.sql("UPDATE batches SET state='held' WHERE id=?").run(id);
      this.sql("UPDATE deliveries SET state='held' WHERE batch_id=? AND state!='received'").run(id);
      return { held: true };
    });
  }
  /** 可重试失败：立刻释放租约，让调度器按退避节奏重新领取同一批。 */
  release(id: string, lease: string, now: number): { released: true } {
    if (!this.sql("UPDATE batches SET lease_until=0 WHERE id=? AND lease=? AND state='leased' AND lease_until>?").run(id, lease, now).changes) {
      throw new MessagingError('stale_lease', '交付租约已失效', 409);
    }
    return { released: true };
  }
  resume(endpoint: string): void {
    this.transaction(() => {
      this.endpoint(endpoint);
      this.sql("UPDATE batches SET state='leased',lease_until=0,attempts=0 WHERE endpoint=? AND state='held'").run(endpoint);
      this.sql("UPDATE deliveries SET state='leased' WHERE endpoint=? AND state='held'").run(endpoint);
    });
  }
  /** Delete fully delivered messages older than the cutoff. Pending/leased/held deliveries are never pruned. */
  prune(before: number, limit = 1000): { deleted: number; bytes: number } {
    return this.transaction(() => {
      const rows = this.sql(`SELECT m.id,m.bytes FROM messages m
        WHERE m.received_at < ?
          AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.message_id=m.id AND d.state!='received')
        ORDER BY m.seq LIMIT ?`).all(before, limit) as { id: string; bytes: number }[];
      if (!rows.length) return { deleted: 0, bytes: 0 };
      let bytes = 0;
      for (const row of rows) {
        bytes += row.bytes;
        this.sql('DELETE FROM deliveries WHERE message_id=?').run(row.id);
        this.sql('DELETE FROM messages WHERE id=?').run(row.id);
      }
      this.sql('UPDATE hub_state SET stored_bytes=MAX(0,stored_bytes-?) WHERE id=1').run(bytes);
      this.sql(`DELETE FROM batches WHERE state='received'
        AND NOT EXISTS (SELECT 1 FROM deliveries WHERE batch_id=batches.id)`).run();
      return { deleted: rows.length, bytes };
    });
  }

  inspect(id: string, sourceId: string, admin: boolean): unknown {
    const row = this.sql('SELECT m.*,s.name AS source FROM messages m JOIN identities s ON s.id=m.source_id WHERE m.id=?').get(id) as (MessageRow & { source: string }) | undefined;
    if (!row) throw new MessagingError('not_found', '消息不存在', 404);
    const own = row.source_id === sourceId;
    const deliveries = this.sql(`SELECT d.endpoint,d.state FROM deliveries d JOIN endpoints e ON e.name=d.endpoint
      WHERE d.message_id=? AND (? OR e.owner_id=?)`).all(id, admin || own ? 1 : 0, sourceId);
    if (!admin && !own && !deliveries.length) throw new MessagingError('not_found', '消息不存在', 404);
    return { id, source: row.source, type: row.type, content: JSON.parse(row.content), received_at: new Date(row.received_at).toISOString(), deliveries };
  }
  status(): unknown {
    const config = this.sql('SELECT * FROM hub_state WHERE id=1').get();
    const queues = this.sql('SELECT endpoint,state,COUNT(*) AS count FROM deliveries GROUP BY endpoint,state').all();
    return { config, queues };
  }
}
interface MessageRow {
  id: string; seq: number; source_id: string; type: string; content: string; received_at: number; bytes: number;
}
interface BatchRow {
  id: string; endpoint: string; state: 'leased' | 'received' | 'held'; lease: string; lease_until: number; attempts: number;
}
