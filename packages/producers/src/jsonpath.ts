import jmespath from 'jmespath';

/**
 * 把 `$.a.b` / `$[*]` / `$` 归一化成 jmespath 表达式。
 * 允许用户按常见 JSONPath 写法书写，内部统一为 jmespath 语义（`$` -> `@`）。
 */
export function normalizeExpr(expr: string): string {
  let e = expr.trim();
  if (e === '$' || e === '@') return '@';
  if (e.startsWith('$')) e = e.slice(1);
  if (e.startsWith('.')) e = e.slice(1);
  return e === '' ? '@' : e;
}

export function query(data: unknown, expr: string): unknown {
  return jmespath.search(data as object, normalizeExpr(expr));
}
