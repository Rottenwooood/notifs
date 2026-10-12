const UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** 解析 "60s" / "5m" / "1h" / "500ms" / "90"（默认秒）为毫秒。 */
export function parseInterval(input: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i.exec(input.trim());
  if (!m) throw new Error(`非法时间间隔: ${input}`);
  const value = Number(m[1]);
  const unit = (m[2] ?? 's').toLowerCase();
  return Math.round(value * (UNITS[unit] ?? 1000));
}
