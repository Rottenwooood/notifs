import type { Json, MessageInput, SubscriptionSpec } from '@notify-hub/contracts';

function glob(pattern: string): (value: string) => boolean {
  const expression = new RegExp(`^${pattern.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return value => expression.test(value);
}
function path(content: Json, field: string): unknown {
  let value: unknown = content;
  for (const key of field.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every(k => Object.hasOwn(b, k) && equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
/** No storage or rendering dependencies. Compile once per committed configuration revision. */
export class MessageRouter {
  private exact = new Map<string, Compiled[]>();
  private patterns: Compiled[] = [];
  constructor(specs: SubscriptionSpec[]) {
    for (const spec of specs) {
      if (!spec.enabled) continue;
      const rule: Compiled = {
        endpoint: spec.endpoint,
        matchesSource: glob(spec.source),
        matchesType: glob(spec.type),
        conditions: spec.all.map(p => content => {
          const v = path(content, p.field);
          switch (p.op) {
            case 'exists': return (v !== undefined) === p.value;
            case 'eq': return equal(v, p.value);
            case 'ne': return !equal(v, p.value);
            case 'in': return Array.isArray(p.value) && p.value.some(x => equal(x, v));
            case 'gt': return typeof v === 'number' && typeof p.value === 'number' && v > p.value;
            case 'lt': return typeof v === 'number' && typeof p.value === 'number' && v < p.value;
          }
        }),
      };
      if (spec.type.includes('*')) this.patterns.push(rule);
      else this.exact.set(spec.type, [...(this.exact.get(spec.type) ?? []), rule]);
    }
  }
  route(source: string, message: MessageInput, to?: string[]): string[] {
    const targets = new Set(to);
    const result = new Set<string>();
    for (const rule of [...(this.exact.get(message.type) ?? []), ...this.patterns]) {
      if (to && !targets.has(rule.endpoint)) continue;
      if (rule.matchesSource(source) && rule.matchesType(message.type) && rule.conditions.every(f => f(message.content))) result.add(rule.endpoint);
    }
    return [...result].sort();
  }
}
interface Compiled {
  endpoint: string;
  matchesSource(value: string): boolean;
  matchesType(value: string): boolean;
  conditions: ((content: Json) => boolean)[];
}
