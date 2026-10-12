import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Authoring } from '@notify-hub/authoring';
import { getChannelImpl, channelKinds } from '@notify-hub/channels';
import { RuleSpecSchema } from '@notify-hub/contracts';
import type { SecretBox, Store } from '@notify-hub/store';
import { clearSessionCookie, currentUser, login, setSessionCookie } from '../auth.ts';

export interface AdminDeps {
  secretBox?: SecretBox;
  authoring?: Authoring;
  /** 读取某个 producer 的运行日志（由 supervisor 提供） */
  producerLogs?: (producerId: string) => string[];
  /** producer 启用状态变化后回调（触发 supervisor.reconcile） */
  onProducersChanged?: () => void;
  llmConfigured?: boolean;
  secureCookies?: boolean;
}

function guard(req: FastifyRequest, reply: FastifyReply, store: Store): boolean {
  if (!currentUser(req, store)) {
    reply.code(401).send({ error: '未登录' });
    return false;
  }
  return true;
}

export function registerAuthRoutes(app: FastifyInstance, store: Store, deps: AdminDeps): void {
  app.post('/api/v1/auth/login', async (req, reply) => {
    const body = (req.body ?? {}) as { username?: string; password?: string };
    if (!body.username || !body.password) return reply.code(400).send({ error: '用户名和密码必填' });
    const token = login(store, body.username, body.password);
    if (!token) return reply.code(401).send({ error: '用户名或密码错误' });
    setSessionCookie(reply, token, deps.secureCookies ?? false);
    return { ok: true, username: body.username };
  });

  app.post('/api/v1/auth/logout', async (req, reply) => {
    const me = currentUser(req, store);
    if (me) store.deleteSession(me.token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/api/v1/auth/me', async (req, reply) => {
    const me = currentUser(req, store);
    if (!me) return reply.code(401).send({ error: '未登录' });
    return { username: me.user.username };
  });
}

export function registerAdminRoutes(app: FastifyInstance, store: Store, deps: AdminDeps): void {
  const me = (req: FastifyRequest, reply: FastifyReply): boolean => guard(req, reply, store);

  // ------------------------------------------------------------- overview
  app.get('/api/v1/admin/overview', async (req, reply) => {
    if (!me(req, reply)) return;
    const producers = store.listProducers();
    return {
      deliveries: store.deliveryStats(),
      counts: {
        sources: store.listSources().length,
        channels: store.listChannels().length,
        rules: store.listRules().length,
        producers: producers.length,
        enabledProducers: producers.filter((p) => p.enabled).length,
      },
      producers: producers.map((p) => ({
        slug: store.getSourceById(p.sourceId)?.name ?? p.sourceId,
        kind: p.kind,
        status: p.status,
        enabled: p.enabled,
        restarts: p.restartCount,
      })),
      llmConfigured: deps.llmConfigured ?? false,
    };
  });

  // -------------------------------------------------------------- sources
  app.get('/api/v1/admin/sources', async (req, reply) => {
    if (!me(req, reply)) return;
    return store.listSources().map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      enabled: s.enabled,
      dedupTtlSec: s.dedupTtlSec,
    }));
  });

  app.post('/api/v1/admin/sources', async (req, reply) => {
    if (!me(req, reply)) return;
    const body = (req.body ?? {}) as { name?: string; dedupTtlSec?: number };
    if (!body.name) return reply.code(400).send({ error: 'name 必填' });
    const { source, token } = store.createSource({
      name: body.name,
      dedupTtlSec: body.dedupTtlSec ?? 86400,
    });
    // token 只在此刻返回一次（库里只存指纹）
    return { id: source.id, name: source.name, token };
  });

  app.delete('/api/v1/admin/sources/:id', async (req, reply) => {
    if (!me(req, reply)) return;
    store.deleteSource((req.params as { id: string }).id);
    return { ok: true };
  });

  // ------------------------------------------------------------- channels
  app.get('/api/v1/admin/channels', async (req, reply) => {
    if (!me(req, reply)) return;
    return {
      kinds: channelKinds(),
      channels: store.listChannels().map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        config: JSON.parse(c.configJson),
        enabled: c.enabled,
      })),
    };
  });

  app.post('/api/v1/admin/channels', async (req, reply) => {
    if (!me(req, reply)) return;
    const body = (req.body ?? {}) as { name?: string; kind?: string; config?: unknown; rateLimit?: unknown };
    if (!body.name || !body.kind) return reply.code(400).send({ error: 'name 与 kind 必填' });
    const impl = getChannelImpl(body.kind);
    if (!impl) return reply.code(400).send({ error: `未知通道类型：${body.kind}` });
    const check = impl.validateConfig(body.config);
    if (!check.ok) return reply.code(400).send({ error: check.error });
    const row = store.upsertChannel({
      name: body.name,
      kind: body.kind,
      config: body.config,
      rateLimit: body.rateLimit,
    });
    return { id: row.id, name: row.name, kind: row.kind };
  });

  app.delete('/api/v1/admin/channels/:id', async (req, reply) => {
    if (!me(req, reply)) return;
    store.deleteChannel((req.params as { id: string }).id);
    return { ok: true };
  });

  // ---------------------------------------------------------------- rules
  app.get('/api/v1/admin/rules', async (req, reply) => {
    if (!me(req, reply)) return;
    return store.listRules().map((r) => ({
      id: r.id,
      name: r.name,
      enabled: r.enabled,
      priority: r.priority,
      when: JSON.parse(r.whenJson),
      actions: JSON.parse(r.actionsJson),
    }));
  });

  app.post('/api/v1/admin/rules', async (req, reply) => {
    if (!me(req, reply)) return;
    const parsed = RuleSpecSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues.map((i) => i.message).join('；') });
    }
    const row = store.upsertRule(parsed.data);
    return { id: row.id, name: row.name };
  });

  app.delete('/api/v1/admin/rules/:id', async (req, reply) => {
    if (!me(req, reply)) return;
    store.deleteRule((req.params as { id: string }).id);
    return { ok: true };
  });

  // ------------------------------------------------------------ producers
  const slugOf = (p: { sourceId: string }): string => store.getSourceById(p.sourceId)?.name ?? p.sourceId;

  app.get('/api/v1/admin/producers', async (req, reply) => {
    if (!me(req, reply)) return;
    return store.listProducers().map((p) => ({
      id: p.id,
      slug: slugOf(p),
      kind: p.kind,
      enabled: p.enabled,
      status: p.status,
      pid: p.pid,
      restarts: p.restartCount,
      lastError: p.lastError,
      lastHeartbeatAt: p.lastHeartbeatAt,
    }));
  });

  app.post('/api/v1/admin/producers/:id/enable', async (req, reply) => {
    if (!me(req, reply)) return;
    store.setProducerEnabled((req.params as { id: string }).id, true);
    deps.onProducersChanged?.();
    return { ok: true };
  });

  app.post('/api/v1/admin/producers/:id/disable', async (req, reply) => {
    if (!me(req, reply)) return;
    store.setProducerEnabled((req.params as { id: string }).id, false);
    deps.onProducersChanged?.();
    return { ok: true };
  });

  app.get('/api/v1/admin/producers/:id/logs', async (req, reply) => {
    if (!me(req, reply)) return;
    const lines = deps.producerLogs?.((req.params as { id: string }).id) ?? [];
    return { lines };
  });

  // --------------------------------------------------------------- events
  app.get('/api/v1/admin/events', async (req, reply) => {
    if (!me(req, reply)) return;
    const limit = Number((req.query as { limit?: string }).limit ?? 100);
    return store.listEvents(Number.isFinite(limit) ? limit : 100);
  });

  // ---------------------------------------------------------- deliveries
  app.get('/api/v1/admin/deliveries', async (req, reply) => {
    if (!me(req, reply)) return;
    const limit = Number((req.query as { limit?: string }).limit ?? 100);
    return store.listDeliveries(Number.isFinite(limit) ? limit : 100).map((d) => ({
      id: d.id,
      channel: store.getChannelById(d.channelId)?.name ?? d.channelId,
      status: d.status,
      attempts: d.attempts,
      lastError: d.lastError,
      createdAt: d.createdAt,
      sentAt: d.sentAt,
    }));
  });

  app.post('/api/v1/admin/deliveries/:id/retry', async (req, reply) => {
    if (!me(req, reply)) return;
    const changed = store.retryDelivery((req.params as { id: string }).id);
    return changed > 0 ? { ok: true } : reply.code(400).send({ error: '该投递当前不可重试' });
  });

  // ---------------------------------------------------------------- 密钥
  app.get('/api/v1/admin/secrets', async (req, reply) => {
    if (!me(req, reply)) return;
    return { names: deps.secretBox?.names() ?? [] };
  });

  app.put('/api/v1/admin/secrets/:name', async (req, reply) => {
    if (!me(req, reply)) return;
    if (!deps.secretBox) return reply.code(503).send({ error: '密钥库不可用' });
    const { value } = (req.body ?? {}) as { value?: string };
    if (typeof value !== 'string' || !value) return reply.code(400).send({ error: 'value 必填' });
    deps.secretBox.set((req.params as { name: string }).name, value);
    return { ok: true };
  });

  app.delete('/api/v1/admin/secrets/:name', async (req, reply) => {
    if (!me(req, reply)) return;
    deps.secretBox?.remove((req.params as { name: string }).name);
    return { ok: true };
  });

  // -------------------------------------------------------------- agent
  const authoring = (): Authoring => {
    if (!deps.authoring) throw new Error('生成能力不可用：未配置 LLM');
    return deps.authoring;
  };

  app.get('/api/v1/admin/drafts', async (req, reply) => {
    if (!me(req, reply)) return;
    return deps.authoring?.listDrafts() ?? [];
  });

  app.get('/api/v1/admin/drafts/:slug', async (req, reply) => {
    if (!me(req, reply)) return;
    const slug = (req.params as { slug: string }).slug;
    const a = authoring();
    const meta = a.getDraft(slug);
    if (!meta) return reply.code(404).send({ error: '没有该草稿' });
    return { meta, files: a.readFiles(slug) };
  });

  app.post('/api/v1/admin/drafts/:slug/check', async (req, reply) => {
    if (!me(req, reply)) return;
    return authoring().check((req.params as { slug: string }).slug);
  });

  app.post('/api/v1/admin/drafts/:slug/trial', async (req, reply) => {
    if (!me(req, reply)) return;
    const seconds = Number((req.body as { seconds?: number } | undefined)?.seconds ?? 15);
    const result = await authoring().trial((req.params as { slug: string }).slug, {
      timeoutMs: Math.min(Math.max(seconds, 1), 120) * 1000,
    });
    return result;
  });

  app.post('/api/v1/admin/drafts/:slug/approve', async (req, reply) => {
    if (!me(req, reply)) return;
    try {
      return authoring().approve((req.params as { slug: string }).slug);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/v1/admin/drafts/:slug/reject', async (req, reply) => {
    if (!me(req, reply)) return;
    const reason = (req.body as { reason?: string } | undefined)?.reason ?? '未说明';
    return authoring().reject((req.params as { slug: string }).slug, reason);
  });

  app.post('/api/v1/admin/author', async (req, reply) => {
    if (!me(req, reply)) return;
    const requirement = (req.body as { requirement?: string } | undefined)?.requirement?.trim();
    if (!requirement) return reply.code(400).send({ error: 'requirement 必填' });
    try {
      return await authoring().generate(requirement);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
