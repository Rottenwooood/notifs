import { EventInputSchema, type EventInput, type PollerSpec } from '@notify-hub/contracts';
import { query } from './jsonpath.ts';

/** Poller 的持久化快照：条目签名表 + 条件请求凭据。 */
export interface PollerState {
  etag?: string;
  lastModified?: string;
  /** itemKey -> 签名（new_item 恒为 "1"；field_changed 为字段值；threshold 为 on/off） */
  items: Record<string, string>;
}

export interface PollerDeps {
  fetchImpl?: typeof fetch;
  /** {{secrets.NAME}} 的取值来源 */
  secrets?: Record<string, string | undefined>;
}

export interface PollerResult {
  events: EventInput[];
  state: PollerState;
  notModified: boolean;
  /** 映射失败被跳过的条目（配置问题；跳过以免单个坏条目卡死整轮） */
  errors: string[];
}

const SEVERITIES = new Set(['info', 'warn', 'critical']);

function resolveSecrets(tpl: string, secrets: Record<string, string | undefined>): string {
  return tpl.replace(/\{\{\s*secrets\.([\w.]+)\s*\}\}/g, (_m, k: string) => secrets[k] ?? '');
}

function evalOp(v: number, op: string, target: number): boolean {
  switch (op) {
    case 'gt':
      return v > target;
    case 'gte':
      return v >= target;
    case 'lt':
      return v < target;
    case 'lte':
      return v <= target;
    case 'ne':
      return v !== target;
    case 'eq':
      return v === target;
    default:
      return false;
  }
}

/**
 * 单个 map 取值的语义：
 * - `$`                → 整个条目对象
 * - `$.a.b` / `a.b`    → jmespath 取值
 * - `"字面量"`         → 字符串字面量（也支持单引号）
 * - `"x{{ $.id }}y"`   → 字面量里用 {{ }} 插值（jmespath）
 */
export function resolveMapValue(expr: string, item: unknown): unknown {
  const t = expr.trim();
  if (t === '$') return item;
  const quoted = /^(['"])([\s\S]*)\1$/.exec(t);
  if (quoted) {
    const inner = quoted[2]!;
    if (inner.includes('{{')) {
      return inner.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, e: string) => {
        const v = query(item, e);
        if (v == null) return '';
        return typeof v === 'object' ? JSON.stringify(v) : String(v);
      });
    }
    return inner;
  }
  return query(item, expr);
}

/** 把一条源条目按 map 映射成事件信封并校验（§5.3.3）。 */
export function buildEvent(spec: PollerSpec, item: unknown): EventInput {
  const raw: Record<string, unknown> = {};
  for (const [field, expr] of Object.entries(spec.map)) {
    raw[field] = resolveMapValue(expr, item);
  }
  const ev: Record<string, unknown> = {
    type: raw['type'] == null ? '' : String(raw['type']),
    text: raw['text'] == null ? '' : String(raw['text']),
  };
  if (raw['title'] != null) ev['title'] = String(raw['title']);
  if (typeof raw['url'] === 'string' && /^https?:\/\//i.test(raw['url'])) ev['url'] = raw['url'];
  if (raw['severity'] != null && SEVERITIES.has(String(raw['severity']))) ev['severity'] = String(raw['severity']);
  if (raw['dedup_key'] != null) ev['dedup_key'] = String(raw['dedup_key']);
  if (typeof raw['at'] === 'string' && !Number.isNaN(Date.parse(raw['at']))) {
    ev['at'] = new Date(raw['at']).toISOString();
  }
  if (raw['data'] && typeof raw['data'] === 'object') ev['data'] = raw['data'] as Record<string, unknown>;
  return EventInputSchema.parse(ev);
}

/**
 * 跑一次轮询：拉取 → 取条目 → 与上次快照比对 → 产出事件（§5.3.3）。
 * 失败时抛错，**由调用方保证不更新快照**（避免丢事件/误判）。
 */
export async function runPoller(
  spec: PollerSpec,
  state: PollerState,
  deps: PollerDeps = {},
): Promise<PollerResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const secrets = deps.secrets ?? {};

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(spec.request.headers ?? {})) headers[k] = resolveSecrets(v, secrets);
  if (spec.request.conditional?.etag && state.etag) headers['if-none-match'] = state.etag;
  if (spec.request.conditional?.lastModified && state.lastModified) {
    headers['if-modified-since'] = state.lastModified;
  }

  const res = await fetchImpl(spec.request.url, {
    method: spec.request.method,
    headers,
    body: spec.request.body != null ? JSON.stringify(spec.request.body) : undefined,
  });
  if (res.status === 304) return { events: [], state, notModified: true, errors: [] };
  if (!res.ok) throw new Error(`轮询失败: HTTP ${res.status}`);

  const json = (await res.json()) as unknown;
  const extracted = query(json, spec.extract);
  const items: unknown[] = Array.isArray(extracted) ? extracted : [];

  const nextItems: Record<string, string> = {};
  const events: EventInput[] = [];
  const errors: string[] = [];

  for (const item of items) {
    const keyVal = query(item, spec.key);
    if (keyVal == null) continue;
    const itemKey = String(keyVal);
    let signature = '1';
    let emit = false;

    if (spec.change.on === 'new_item') {
      emit = !(itemKey in state.items);
    } else if (spec.change.on === 'field_changed') {
      const fieldExpr = spec.change.field ?? spec.key;
      signature = String(query(item, fieldExpr) ?? '');
      emit = state.items[itemKey] !== signature;
    } else {
      const fieldExpr = spec.change.field ?? spec.key;
      const v = Number(query(item, fieldExpr));
      const cond = evalOp(v, spec.change.op ?? 'gt', spec.change.value ?? 0);
      signature = cond ? 'on' : 'off';
      emit = cond && state.items[itemKey] !== 'on';
    }

    nextItems[itemKey] = signature;
    if (!emit) continue;
    try {
      events.push(buildEvent(spec, item));
    } catch (err) {
      // 单条映射失败：跳过并记录，但**仍推进快照**，避免坏条目每轮都重试
      errors.push(`item ${itemKey}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
    }
  }

  const nextState: PollerState = { items: nextItems };
  const etag = res.headers.get('etag');
  const lastModified = res.headers.get('last-modified');
  if (etag) nextState.etag = etag;
  if (lastModified) nextState.lastModified = lastModified;

  return { events, state: nextState, notModified: false, errors };
}
