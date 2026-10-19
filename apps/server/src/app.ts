import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { sha256, type SourceRow, type Store } from '@notify-hub/store';
import { ingestOne } from './ingest.ts';

export interface AppDeps {
  store: Store;
  logger?: {
    info(obj: unknown, msg?: string): void;
    warn(obj: unknown, msg?: string): void;
    error(obj: unknown, msg?: string): void;
  };
  logLevel?: string;
  /** 收到 managed producer 心跳时回调（用于重置退避计数）。 */
  onHeartbeat?: (producerId: string) => void;
}

const MAX_BATCH = 100;

function authenticate(req: FastifyRequest, store: Store): SourceRow | null {
  const header = req.headers['authorization'];
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  if (!token) return null;
  return store.getSourceByTokenHash(sha256(token)) ?? null;
}

export function buildServer(deps: AppDeps): FastifyInstance {
  const { store } = deps;
  const app = Fastify({
    logger: deps.logger ? { level: deps.logLevel ?? 'info' } : false,
    bodyLimit: 1_048_576,
  });

  app.get('/health', async () => ({
    ok: true,
    deliveries: store.deliveryStats(),
  }));

  app.post('/api/v1/events', async (req, reply) => {
    const source = authenticate(req, store);
    if (!source) return reply.code(401).send({ error: '无效或缺失的 token' });
    if (!source.enabled) return reply.code(403).send({ error: '源已禁用' });

    const body = req.body as unknown;
    const items = Array.isArray(body) ? body : [body];
    if (items.length === 0) return reply.code(400).send({ error: '空请求体' });
    if (items.length > MAX_BATCH) return reply.code(400).send({ error: `单次最多 ${MAX_BATCH} 条` });

    const results = items.map((it) => ingestOne(source, it, { store }));

    if (items.length === 1) {
      const r = results[0]!;
      if (!r.accepted) return reply.code(400).send({ error: r.error });
      return reply.code(202).send({
        accepted: true,
        deduplicated: r.deduplicated,
        event_ids: r.eventId ? [r.eventId] : [],
        dispatches: r.dispatches,
      });
    }

    return reply.code(202).send({
      accepted: results.filter((r) => r.accepted).length,
      deduplicated: results.filter((r) => r.deduplicated).length,
      event_ids: results.map((r) => r.eventId).filter((x): x is string => !!x),
      errors: results.filter((r) => !r.accepted).map((r) => r.error),
    });
  });

  app.post('/api/v1/producers/:id/heartbeat', async (req, reply) => {
    const source = authenticate(req, store);
    if (!source) return reply.code(401).send({ error: '无效或缺失的 token' });
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { status?: string; detail?: string; cursor?: string };
    const changed = store.updateProducerHeartbeat(id, body.status ?? 'ok', body.detail ?? null);
    if (changed === 0) return reply.code(404).send({ error: 'producer 不存在' });
    if ((body.status ?? 'ok') === 'ok') deps.onHeartbeat?.(id);
    return { ok: true };
  });

  app.post('/api/v1/producers/:id/state', async (req, reply) => {
    const source = authenticate(req, store);
    if (!source) return reply.code(401).send({ error: '无效或缺失的 token' });
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { detail?: string; cursor?: string };
    const changed = store.updateProducerHeartbeat(id, 'ok', body.detail ?? null);
    if (changed === 0) return reply.code(404).send({ error: 'producer 不存在' });
    return { ok: true };
  });

  /**
   * 给 agent（MCP）用的只读接口：和 ingest 一样用 source token 鉴权，
   * 但只能看到"自己这个源"发出去的东西。
   */
  app.get('/api/v1/events', async (req, reply) => {
    const source = authenticate(req, store);
    if (!source) return reply.code(401).send({ error: '无效或缺失的 token' });
    const q = req.query as { limit?: string; type?: string };
    const limit = Number(q.limit ?? 20);
    if (!Number.isFinite(limit) || limit <= 0) return reply.code(400).send({ error: 'limit 非法' });
    return { events: store.listEventsForSource(source.id, { limit, type: q.type }) };
  });

  app.get('/api/v1/deliveries', async (req, reply) => {
    const source = authenticate(req, store);
    if (!source) return reply.code(401).send({ error: '无效或缺失的 token' });
    const q = req.query as { limit?: string; status?: string };
    const limit = Number(q.limit ?? 20);
    if (!Number.isFinite(limit) || limit <= 0) return reply.code(400).send({ error: 'limit 非法' });
    if (q.status && !['pending', 'sending', 'sent', 'dead'].includes(q.status)) {
      return reply.code(400).send({ error: 'status 只能是 pending|sending|sent|dead' });
    }
    return { deliveries: store.listDeliveriesForSource(source.id, { limit, status: q.status }) };
  });

  app.get('/api/v1/status', async (req, reply) => {
    const source = authenticate(req, store);
    if (!source) return reply.code(401).send({ error: '无效或缺失的 token' });
    return {
      source: { name: source.name, enabled: source.enabled, dedup_ttl_sec: source.dedupTtlSec },
      channels: store.listChannels().map((c) => ({ name: c.name, kind: c.kind, enabled: c.enabled })),
      rules: store.listRules().map((r) => ({ name: r.name, enabled: r.enabled, priority: r.priority })),
      producers: store.listProducers().map((p) => ({
        name: store.getSourceById(p.sourceId)?.name ?? p.sourceId,
        kind: p.kind,
        enabled: p.enabled,
        status: p.status,
        restarts: p.restartCount,
        last_error: p.lastError,
      })),
      deliveries: store.deliveryStats(),
    };
  });

  return app;
}
