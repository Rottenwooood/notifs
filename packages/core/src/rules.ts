import type { RenderedMessage, StoredEvent } from '@notify-hub/contracts';
import type { ChannelRow, RuleRow } from '@notify-hub/store';
import { getPath, renderMessage, type TemplateSpec } from './template.ts';

/** 把 glob（* 通配）转成正则。 */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

export function matchGlob(value: string, glob: string): boolean {
  if (glob === '*') return true;
  return globToRegExp(glob).test(value);
}

/** 单条字段谓词，如 {field:"data.author", ne:"me"} */
export interface Predicate {
  field?: string;
  eq?: unknown;
  ne?: unknown;
  in?: unknown[];
  nin?: unknown[];
  gt?: number;
  lt?: number;
  contains?: string;
  exists?: boolean;
}

export function evalPredicate(event: StoredEvent, p: Predicate): boolean {
  const value = p.field ? getPath(event, p.field) : undefined;
  if (p.exists !== undefined) return (value !== undefined) === p.exists;
  if (p.eq !== undefined) return value === p.eq;
  if (p.ne !== undefined) return value !== p.ne;
  if (p.in !== undefined) return p.in.includes(value);
  if (p.nin !== undefined) return !p.nin.includes(value);
  if (p.gt !== undefined) return typeof value === 'number' && value > p.gt;
  if (p.lt !== undefined) return typeof value === 'number' && value < p.lt;
  if (p.contains !== undefined) return typeof value === 'string' && value.includes(p.contains);
  return true;
}

export interface RuleWhen {
  source?: string;
  type?: string;
  all?: Predicate[];
  not?: Predicate[];
}

export function matchWhen(event: StoredEvent, when: RuleWhen): boolean {
  if (when.source && !matchGlob(event.source, when.source)) return false;
  if (when.type && !matchGlob(event.type, when.type)) return false;
  if (when.all && !when.all.every((p) => evalPredicate(event, p))) return false;
  if (when.not && when.not.some((p) => evalPredicate(event, p))) return false;
  return true;
}

export interface DispatchPlan {
  ruleId: string;
  ruleName: string;
  channel: ChannelRow;
  rendered: RenderedMessage;
  idempotencyKey: string;
}

/**
 * 评估所有规则，产出投递计划（§5.5 处理流程的前半段）。
 * 去重 / 幂等键在此计算；节流与静默（需要状态）留给调度层处理。
 */
export function planDispatch(
  event: StoredEvent,
  rules: RuleRow[],
  channels: { byName: Map<string, ChannelRow>; byId: Map<string, ChannelRow> },
  templates?: Map<string, TemplateSpec>,
): DispatchPlan[] {
  const plans: DispatchPlan[] = [];
  for (const rule of rules) {
    let when: RuleWhen;
    let actions: { channel: string; template?: string }[];
    try {
      when = JSON.parse(rule.whenJson) as RuleWhen;
      actions = JSON.parse(rule.actionsJson) as { channel: string; template?: string }[];
    } catch {
      continue;
    }
    if (!matchWhen(event, when)) continue;

    for (const action of actions) {
      const channel = channels.byName.get(action.channel) ?? channels.byId.get(action.channel);
      if (!channel || !channel.enabled) continue;
      const tpl = action.template && action.template !== 'default' ? templates?.get(action.template) : undefined;
      const rendered = renderMessage(event, tpl);
      plans.push({
        ruleId: rule.id,
        ruleName: rule.name,
        channel,
        rendered,
        idempotencyKey: `${rule.id}:${channel.id}:${event.event_id}`,
      });
    }

    if (rule.exclusive) break;
  }
  return plans;
}

/** 指数退避（§5.6.3）：默认 5s,15s,1m,5m,15m,1h,3h,6h，带 ±10% 抖动。 */
export const BACKOFF_MS = [5_000, 15_000, 60_000, 300_000, 900_000, 3_600_000, 10_800_000, 21_600_000];

export function backoffDelay(
  attempt: number,
  opts: { table?: number[]; rand?: () => number } = {},
): number {
  const table = opts.table && opts.table.length > 0 ? opts.table : BACKOFF_MS;
  const rand = opts.rand ?? Math.random;
  const base = table[Math.min(attempt, table.length - 1)] ?? table[table.length - 1]!;
  const jitter = 0.9 + rand() * 0.2;
  return Math.round(base * jitter);
}
