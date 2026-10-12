import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { ulid } from 'ulid';
import type { RuleSpec, Severity, StoredEvent } from '@notify-hub/contracts';
import { MIGRATIONS } from './schema.ts';

export type { RuleSpec } from '@notify-hub/contracts';

export interface SourceRow {
  id: string;
  name: string;
  kind: 'push' | 'poller' | 'managed';
  tokenHash: string;
  dedupTtlSec: number;
  mappingJson: string | null;
  enabled: boolean;
  owner: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RuleRow {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  exclusive: boolean;
  whenJson: string;
  behaviorJson: string | null;
  actionsJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelRow {
  id: string;
  name: string;
  kind: string;
  configJson: string;
  enabled: boolean;
  rateLimitJson: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProducerRow {
  id: string;
  sourceId: string;
  kind: 'managed' | 'poller';
  status: string | null;
  pid: number | null;
  configJson: string | null;
  stateDir: string | null;
  lastHeartbeatAt: string | null;
  restartCount: number;
  lastError: string | null;
  origin: 'handwritten' | 'agent_generated' | null;
  draftPath: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryRow {
  id: string;
  eventId: string;
  ruleId: string | null;
  channelId: string;
  idempotencyKey: string;
  status: 'pending' | 'sending' | 'sent' | 'dead';
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  notBefore: string | null;
  claimedAt: string | null;
  lastError: string | null;
  renderedJson: string | null;
  providerId: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface EnqueueDeliveryInput {
  eventId: string;
  ruleId: string | null;
  channelId: string;
  idempotencyKey: string;
  renderedJson: string;
  notBefore?: string | null;
  now?: Date;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

const nowIso = (d: Date = new Date()): string => d.toISOString();

export class Store {
  readonly db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
  }

  close(): void {
    this.db.close();
  }

  migrate(): void {
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);`,
    );
    const applied = new Set(
      (this.db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
        (r) => r.version,
      ),
    );
    MIGRATIONS.forEach((sql, i) => {
      const version = i + 1;
      if (applied.has(version)) return;
      const run = this.db.transaction(() => {
        this.db.exec(sql);
        this.db
          .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
          .run(version, nowIso());
      });
      run();
    });
  }

  // ---------------------------------------------------------------- sources

  createSource(input: { name: string; kind?: SourceRow['kind']; dedupTtlSec?: number }): {
    source: SourceRow;
    token: string;
  } {
    const token = generateToken();
    const id = ulid();
    const t = nowIso();
    this.db
      .prepare(
        `INSERT INTO sources (id, name, kind, token_hash, dedup_ttl_sec, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(name) DO UPDATE SET token_hash = excluded.token_hash, updated_at = excluded.updated_at`,
      )
      .run(id, input.name, input.kind ?? 'push', sha256(token), input.dedupTtlSec ?? 86400, t, t);
    const source = this.getSourceByName(input.name);
    if (!source) throw new Error('source insert failed');
    return { source, token };
  }

  private mapSource(r: Record<string, unknown>): SourceRow {
    return {
      id: r['id'] as string,
      name: r['name'] as string,
      kind: r['kind'] as SourceRow['kind'],
      tokenHash: r['token_hash'] as string,
      dedupTtlSec: r['dedup_ttl_sec'] as number,
      mappingJson: (r['mapping_json'] as string | null) ?? null,
      enabled: r['enabled'] === 1,
      owner: (r['owner'] as string | null) ?? null,
      createdAt: r['created_at'] as string,
      updatedAt: r['updated_at'] as string,
    };
  }

  getSourceByName(name: string): SourceRow | undefined {
    const r = this.db.prepare('SELECT * FROM sources WHERE name = ?').get(name);
    return r ? this.mapSource(r as Record<string, unknown>) : undefined;
  }

  getSourceByTokenHash(hash: string): SourceRow | undefined {
    const r = this.db.prepare('SELECT * FROM sources WHERE token_hash = ?').get(hash);
    return r ? this.mapSource(r as Record<string, unknown>) : undefined;
  }

  getSourceById(id: string): SourceRow | undefined {
    const r = this.db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
    return r ? this.mapSource(r as Record<string, unknown>) : undefined;
  }

  listSources(): SourceRow[] {
    return (this.db.prepare('SELECT * FROM sources ORDER BY name').all() as Record<string, unknown>[]).map(
      (r) => this.mapSource(r),
    );
  }

  // ----------------------------------------------------------------- events

  insertEvent(sourceId: string, e: StoredEvent, dedupExpiresAt: string | null): void {
    this.db
      .prepare(
        `INSERT INTO events
           (id, source_id, producer_id, type, text, title, url, severity, dedup_key, at, received_at, data_json, dedup_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        e.event_id,
        sourceId,
        e.producer_id,
        e.type,
        e.text,
        e.title,
        e.url,
        e.severity,
        e.dedup_key,
        e.at,
        e.received_at,
        JSON.stringify(e.data),
        dedupExpiresAt,
      );
  }

  /** 幂等预检：是否存在未过期的同 (source, dedup_key) 事件。 */
  findActiveDedup(sourceId: string, dedupKey: string, now: Date = new Date()): { id: string } | undefined {
    const r = this.db
      .prepare(
        `SELECT id FROM events
         WHERE source_id = ? AND dedup_key = ? AND (dedup_expires_at IS NULL OR dedup_expires_at > ?)
         ORDER BY received_at DESC LIMIT 1`,
      )
      .get(sourceId, dedupKey, nowIso(now));
    return r as { id: string } | undefined;
  }

  getEvent(id: string): StoredEvent | undefined {
    const r = this.db.prepare('SELECT * FROM events WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!r) return undefined;
    const sourceId = r['source_id'] as string;
    const src = this.db.prepare('SELECT name FROM sources WHERE id = ?').get(sourceId) as
      | { name: string }
      | undefined;
    return {
      event_id: r['id'] as string,
      source: src?.name ?? sourceId,
      producer_id: (r['producer_id'] as string | null) ?? null,
      type: r['type'] as string,
      text: r['text'] as string,
      title: (r['title'] as string | null) ?? null,
      url: (r['url'] as string | null) ?? null,
      severity: r['severity'] as Severity,
      dedup_key: r['dedup_key'] as string,
      at: r['at'] as string,
      received_at: r['received_at'] as string,
      data: JSON.parse((r['data_json'] as string) || '{}') as Record<string, unknown>,
    };
  }

  // ------------------------------------------------------------------ rules

  private mapRule(r: Record<string, unknown>): RuleRow {
    return {
      id: r['id'] as string,
      name: r['name'] as string,
      enabled: r['enabled'] === 1,
      priority: r['priority'] as number,
      exclusive: r['exclusive'] === 1,
      whenJson: r['when_json'] as string,
      behaviorJson: (r['behavior_json'] as string | null) ?? null,
      actionsJson: r['actions_json'] as string,
      createdAt: r['created_at'] as string,
      updatedAt: r['updated_at'] as string,
    };
  }

  upsertRule(spec: RuleSpec): RuleRow {
    const t = nowIso();
    this.db
      .prepare(
        `INSERT INTO rules (id, name, enabled, priority, exclusive, when_json, behavior_json, actions_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
      )
      .run(
        ulid(),
        spec.name,
        spec.enabled === false ? 0 : 1,
        spec.priority ?? 100,
        spec.behavior?.exclusive ? 1 : 0,
        JSON.stringify(spec.when),
        spec.behavior ? JSON.stringify(spec.behavior) : null,
        JSON.stringify(spec.actions),
        t,
        t,
      );
    const existing = this.db.prepare('SELECT * FROM rules WHERE name = ?').get(spec.name) as
      | Record<string, unknown>
      | undefined;
    if (!existing) throw new Error('rule upsert failed');
    // update in place (idempotent re-seed)
    this.db
      .prepare(
        `UPDATE rules SET enabled=?, priority=?, exclusive=?, when_json=?, behavior_json=?, actions_json=?, updated_at=? WHERE name=?`,
      )
      .run(
        spec.enabled === false ? 0 : 1,
        spec.priority ?? 100,
        spec.behavior?.exclusive ? 1 : 0,
        JSON.stringify(spec.when),
        spec.behavior ? JSON.stringify(spec.behavior) : null,
        JSON.stringify(spec.actions),
        t,
        spec.name,
      );
    return this.mapRule(this.db.prepare('SELECT * FROM rules WHERE name = ?').get(spec.name) as Record<string, unknown>);
  }

  listEnabledRules(): RuleRow[] {
    return (
      this.db.prepare('SELECT * FROM rules WHERE enabled = 1 ORDER BY priority DESC, name').all() as Record<
        string,
        unknown
      >[]
    ).map((r) => this.mapRule(r));
  }

  // --------------------------------------------------------------- channels

  private mapChannel(r: Record<string, unknown>): ChannelRow {
    return {
      id: r['id'] as string,
      name: r['name'] as string,
      kind: r['kind'] as string,
      configJson: r['config_json'] as string,
      enabled: r['enabled'] === 1,
      rateLimitJson: (r['rate_limit_json'] as string | null) ?? null,
      createdAt: r['created_at'] as string,
      updatedAt: r['updated_at'] as string,
    };
  }

  upsertChannel(input: { name: string; kind: string; config: unknown; rateLimit?: unknown }): ChannelRow {
    const t = nowIso();
    this.db
      .prepare(
        `INSERT INTO channels (id, name, kind, config_json, enabled, rate_limit_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET kind=excluded.kind, config_json=excluded.config_json,
           rate_limit_json=excluded.rate_limit_json, updated_at=excluded.updated_at`,
      )
      .run(
        ulid(),
        input.name,
        input.kind,
        JSON.stringify(input.config ?? {}),
        input.rateLimit ? JSON.stringify(input.rateLimit) : null,
        t,
        t,
      );
    const row = this.getChannelByName(input.name);
    if (!row) throw new Error('channel upsert failed');
    return row;
  }

  getChannelByName(name: string): ChannelRow | undefined {
    const r = this.db.prepare('SELECT * FROM channels WHERE name = ?').get(name);
    return r ? this.mapChannel(r as Record<string, unknown>) : undefined;
  }

  getChannelById(id: string): ChannelRow | undefined {
    const r = this.db.prepare('SELECT * FROM channels WHERE id = ?').get(id);
    return r ? this.mapChannel(r as Record<string, unknown>) : undefined;
  }

  listChannels(): ChannelRow[] {
    return (
      this.db.prepare('SELECT * FROM channels ORDER BY name').all() as Record<string, unknown>[]
    ).map((r) => this.mapChannel(r));
  }

  // ------------------------------------------------------------- producers

  private mapProducer(r: Record<string, unknown>): ProducerRow {
    return {
      id: r['id'] as string,
      sourceId: r['source_id'] as string,
      kind: r['kind'] as ProducerRow['kind'],
      status: (r['status'] as string | null) ?? null,
      pid: (r['pid'] as number | null) ?? null,
      configJson: (r['config_json'] as string | null) ?? null,
      stateDir: (r['state_dir'] as string | null) ?? null,
      lastHeartbeatAt: (r['last_heartbeat_at'] as string | null) ?? null,
      restartCount: r['restart_count'] as number,
      lastError: (r['last_error'] as string | null) ?? null,
      origin: (r['origin'] as ProducerRow['origin']) ?? null,
      draftPath: (r['draft_path'] as string | null) ?? null,
      enabled: r['enabled'] === 1,
      createdAt: r['created_at'] as string,
      updatedAt: r['updated_at'] as string,
    };
  }

  /** 按 source 幂等地建立/更新一个 producer（slug = source.name）。 */
  upsertProducer(input: {
    sourceId: string;
    kind: ProducerRow['kind'];
    stateDir: string;
    config: unknown;
    origin?: ProducerRow['origin'];
    /** 仅首次登记时生效 */
    enabled?: boolean;
  }): ProducerRow {
    const t = nowIso();
    const existing = this.getProducerBySourceId(input.sourceId);
    if (existing) {
      this.db
        .prepare(
          `UPDATE producers SET kind=?, state_dir=?, config_json=?, origin=COALESCE(?, origin), updated_at=? WHERE id=?`,
        )
        .run(
          input.kind,
          input.stateDir,
          JSON.stringify(input.config ?? {}),
          input.origin ?? null,
          t,
          existing.id,
        );
      return this.getProducerById(existing.id)!;
    }
    const id = ulid();
    this.db
      .prepare(
        `INSERT INTO producers
           (id, source_id, kind, status, config_json, state_dir, restart_count, origin, enabled, created_at, updated_at)
         VALUES (?, ?, ?, 'stopped', ?, ?, 0, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.sourceId,
        input.kind,
        JSON.stringify(input.config ?? {}),
        input.stateDir,
        input.origin ?? 'handwritten',
        input.enabled === false ? 0 : 1,
        t,
        t,
      );
    return this.getProducerById(id)!;
  }

  getProducerById(id: string): ProducerRow | undefined {
    const r = this.db.prepare('SELECT * FROM producers WHERE id = ?').get(id);
    return r ? this.mapProducer(r as Record<string, unknown>) : undefined;
  }

  getProducerBySourceId(sourceId: string): ProducerRow | undefined {
    const r = this.db.prepare('SELECT * FROM producers WHERE source_id = ?').get(sourceId);
    return r ? this.mapProducer(r as Record<string, unknown>) : undefined;
  }

  getProducerBySlug(slug: string): ProducerRow | undefined {
    const s = this.getSourceByName(slug);
    return s ? this.getProducerBySourceId(s.id) : undefined;
  }

  listProducers(): ProducerRow[] {
    return (
      this.db.prepare('SELECT * FROM producers ORDER BY created_at').all() as Record<string, unknown>[]
    ).map((r) => this.mapProducer(r));
  }

  setProducerEnabled(id: string, enabled: boolean): void {
    this.db
      .prepare('UPDATE producers SET enabled=?, updated_at=? WHERE id=?')
      .run(enabled ? 1 : 0, nowIso(), id);
  }

  setProducerPid(id: string, pid: number | null, status?: string): void {
    this.db
      .prepare('UPDATE producers SET pid=?, status=COALESCE(?, status), updated_at=? WHERE id=?')
      .run(pid, status ?? null, nowIso(), id);
  }

  setProducerStatus(id: string, status: string, error: string | null = null): void {
    this.db
      .prepare('UPDATE producers SET status=?, last_error=?, updated_at=? WHERE id=?')
      .run(status, error, nowIso(), id);
  }

  incProducerRestart(id: string, error: string | null): number {
    this.db
      .prepare('UPDATE producers SET restart_count = restart_count + 1, last_error=?, updated_at=? WHERE id=?')
      .run(error, nowIso(), id);
    return this.getProducerById(id)?.restartCount ?? 0;
  }

  resetProducerRestart(id: string): void {
    this.db.prepare('UPDATE producers SET restart_count=0, updated_at=? WHERE id=?').run(nowIso(), id);
  }

  deleteProducer(id: string): void {
    this.db.prepare('DELETE FROM producers WHERE id = ?').run(id);
  }

  updateProducerHeartbeat(id: string, status: string, detail?: string | null, now: Date = new Date()): number {
    // last_error 只承载错误；ok 心跳会清空它。
    const error = status === 'ok' ? null : (detail ?? null);
    const res = this.db
      .prepare(`UPDATE producers SET last_heartbeat_at=?, status=?, last_error=?, updated_at=? WHERE id=?`)
      .run(nowIso(now), status, error, nowIso(now), id);
    return res.changes;
  }

  // ------------------------------------------------------------- deliveries

  private mapDelivery(r: Record<string, unknown>): DeliveryRow {
    return {
      id: r['id'] as string,
      eventId: r['event_id'] as string,
      ruleId: (r['rule_id'] as string | null) ?? null,
      channelId: r['channel_id'] as string,
      idempotencyKey: r['idempotency_key'] as string,
      status: r['status'] as DeliveryRow['status'],
      attempts: r['attempts'] as number,
      maxAttempts: r['max_attempts'] as number,
      nextAttemptAt: r['next_attempt_at'] as string,
      notBefore: (r['not_before'] as string | null) ?? null,
      claimedAt: (r['claimed_at'] as string | null) ?? null,
      lastError: (r['last_error'] as string | null) ?? null,
      renderedJson: (r['rendered_json'] as string | null) ?? null,
      providerId: (r['provider_id'] as string | null) ?? null,
      createdAt: r['created_at'] as string,
      sentAt: (r['sent_at'] as string | null) ?? null,
    };
  }

  enqueueDelivery(input: EnqueueDeliveryInput): string {
    const id = ulid();
    const now = input.now ?? new Date();
    this.db
      .prepare(
        `INSERT INTO deliveries
           (id, event_id, rule_id, channel_id, idempotency_key, status, attempts, max_attempts,
            next_attempt_at, not_before, created_at, rendered_json)
         VALUES (?, ?, ?, ?, ?, 'pending', 0, 8, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.eventId,
        input.ruleId,
        input.channelId,
        input.idempotencyKey,
        nowIso(now),
        input.notBefore ? nowIso(new Date(input.notBefore)) : null,
        nowIso(now),
        input.renderedJson,
      );
    return id;
  }

  /** 原子认领一批到期 pending 投递（置 sending）。 */
  claimPending(limit: number, now: Date = new Date()): DeliveryRow[] {
    const iso = nowIso(now);
    const tx = this.db.transaction((): DeliveryRow[] => {
      const rows = this.db
        .prepare(
          `SELECT * FROM deliveries
           WHERE status = 'pending' AND next_attempt_at <= ?
             AND (not_before IS NULL OR not_before <= ?)
           ORDER BY created_at LIMIT ?`,
        )
        .all(iso, iso, limit) as Record<string, unknown>[];
      const claim = this.db.prepare(
        `UPDATE deliveries SET status='sending', claimed_at=? WHERE id=? AND status='pending'`,
      );
      const claimed: DeliveryRow[] = [];
      for (const r of rows) {
        const res = claim.run(iso, r['id'] as string);
        if (res.changes === 1) claimed.push(this.mapDelivery({ ...r, status: 'sending', claimed_at: iso }));
      }
      return claimed;
    });
    return tx();
  }

  markSent(id: string, providerId: string | null, now: Date = new Date()): void {
    this.db
      .prepare(`UPDATE deliveries SET status='sent', sent_at=?, provider_id=?, last_error=NULL WHERE id=?`)
      .run(nowIso(now), providerId, id);
  }

  markRetry(id: string, attempts: number, nextAttemptAt: Date, error: string): void {
    this.db
      .prepare(
        `UPDATE deliveries SET status='pending', attempts=?, next_attempt_at=?, last_error=?, claimed_at=NULL WHERE id=?`,
      )
      .run(attempts, nowIso(nextAttemptAt), error, id);
  }

  markDead(id: string, error: string): void {
    this.db
      .prepare(`UPDATE deliveries SET status='dead', last_error=?, claimed_at=NULL WHERE id=?`)
      .run(error, id);
  }

  /** 崩溃补发：把卡在 sending 且认领超时的投递重置为 pending。 */
  resetStuckSending(olderThanMs: number, now: Date = new Date()): number {
    const cutoff = nowIso(new Date(now.getTime() - olderThanMs));
    const res = this.db
      .prepare(
        `UPDATE deliveries SET status='pending', claimed_at=NULL
         WHERE status='sending' AND (claimed_at IS NULL OR claimed_at < ?)`,
      )
      .run(cutoff);
    return res.changes;
  }

  getDelivery(id: string): DeliveryRow | undefined {
    const r = this.db.prepare('SELECT * FROM deliveries WHERE id = ?').get(id);
    return r ? this.mapDelivery(r as Record<string, unknown>) : undefined;
  }

  listDeliveries(limit = 100): DeliveryRow[] {
    return (
      this.db.prepare('SELECT * FROM deliveries ORDER BY created_at DESC LIMIT ?').all(limit) as Record<
        string,
        unknown
      >[]
    ).map((r) => this.mapDelivery(r));
  }

  // ----------------------------------------------------------- poller state

  getPollerState(producerId: string, key = 'default'): string | undefined {
    const r = this.db
      .prepare('SELECT snapshot_json FROM poller_state WHERE producer_id=? AND key=?')
      .get(producerId, key) as { snapshot_json: string } | undefined;
    return r?.snapshot_json;
  }

  setPollerState(producerId: string, key: string, snapshot: string, now: Date = new Date()): void {
    this.db
      .prepare(
        `INSERT INTO poller_state (producer_id, key, snapshot_json, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(producer_id, key) DO UPDATE SET snapshot_json=excluded.snapshot_json, updated_at=excluded.updated_at`,
      )
      .run(producerId, key, snapshot, nowIso(now));
  }

  /** 统计各状态投递数量（供 UI / 健康检查）。 */
  deliveryStats(): Record<string, number> {
    const rows = this.db.prepare('SELECT status, COUNT(*) AS n FROM deliveries GROUP BY status').all() as {
      status: string;
      n: number;
    }[];
    const out: Record<string, number> = { pending: 0, sending: 0, sent: 0, dead: 0 };
    for (const r of rows) out[r.status] = r.n;
    return out;
  }
}

export function openStore(dbPath: string): Store {
  return new Store(dbPath);
}
