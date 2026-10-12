import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { ProducerManifestSchema, type ProducerManifest } from '@notify-hub/contracts';

export interface CheckIssue {
  level: 'error' | 'warn';
  message: string;
}

export interface ProducerCheckReport {
  ok: boolean;
  issues: CheckIssue[];
  manifest?: ProducerManifest;
  /** manifest 声明了、但解析不到的凭据名 */
  credentialsMissing: string[];
}

const KNOWN_INTERPRETERS = new Set(['node', 'python', 'python3', 'bash', 'sh', 'deno', 'bun']);
const SUSPICIOUS: { pattern: RegExp; message: string }[] = [
  { pattern: /\brm\s+-rf\s+\//, message: '代码里出现 rm -rf / 之类的高危删除' },
  { pattern: /\b(curl|wget)\b[^\n|]*\|\s*(sh|bash)\b/, message: '代码里出现 curl|sh 这类管道执行' },
];

function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.startsWith('.')) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, base));
    else out.push(full.slice(base.length + 1));
  }
  return out;
}

/**
 * 静态校验一个监控程序目录（不启动它）。
 * 面向"外部写的程序"：清单是否合法、入口是否存在、解释器是否常见、凭据能不能解析到。
 */
export function checkProducerDir(
  dir: string,
  opts: { resolveSecret?: (name: string) => string | undefined; env?: NodeJS.ProcessEnv } = {},
): ProducerCheckReport {
  const issues: CheckIssue[] = [];
  const manifestPath = join(dir, 'producer.json');

  if (!existsSync(manifestPath)) {
    return { ok: false, issues: [{ level: 'error', message: `缺少 producer.json（${manifestPath}）` }], credentialsMissing: [] };
  }

  let manifest: ProducerManifest | undefined;
  try {
    manifest = ProducerManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
  } catch (err) {
    const detail = err instanceof Error ? err.message.split('\n')[0] : String(err);
    issues.push({ level: 'error', message: `producer.json 不合法：${detail}` });
  }
  if (!manifest) return { ok: false, issues, credentialsMissing: [] };

  const dirName = dir.replace(/\/+$/, '').split('/').pop() ?? '';
  if (dirName !== manifest.slug) {
    issues.push({ level: 'warn', message: `目录名「${dirName}」与 slug「${manifest.slug}」不一致（中心按 slug 识别）` });
  }

  const files = listFiles(dir);

  if (manifest.kind === 'managed') {
    const command = manifest.command ?? [];
    const bin = command[0];
    if (bin && !KNOWN_INTERPRETERS.has(bin)) {
      issues.push({ level: 'warn', message: `解释器「${bin}」不在常见白名单里，请确认中心机器上可用` });
    }
    // 命令里像相对路径的参数，检查文件是否真的存在
    for (const arg of command.slice(1)) {
      if (arg.startsWith('-')) continue;
      const looksLikePath = !isAbsolute(arg) && /[./]/.test(arg);
      if (looksLikePath && !existsSync(join(dir, arg))) {
        issues.push({ level: 'error', message: `启动命令引用的文件不存在：${arg}` });
      }
    }
    const hasCode = files.some((f) => !['producer.json', 'README.md', 'package.json', 'node_modules'].includes(f));
    if (!hasCode) issues.push({ level: 'error', message: '没有任何代码文件' });
  } else {
    if (!manifest.poller) issues.push({ level: 'error', message: 'poller 缺少 poller 配置' });
  }

  for (const f of files) {
    if (!/\.(mjs|js|cjs|ts|py)$/.test(f)) continue;
    let content = '';
    try {
      content = readFileSync(join(dir, f), 'utf8');
    } catch {
      continue;
    }
    for (const s of SUSPICIOUS) {
      if (s.pattern.test(content)) issues.push({ level: 'warn', message: `${f}：${s.message}` });
    }
  }

  const credentialsMissing: string[] = [];
  for (const name of manifest.credentials ?? []) {
    const v = opts.resolveSecret?.(name) ?? opts.env?.[name] ?? opts.env?.[`NOTIFY_SECRET_${name}`];
    if (!v) credentialsMissing.push(name);
  }
  if (credentialsMissing.length > 0) {
    issues.push({
      level: 'warn',
      message: `这些凭据解析不到：${credentialsMissing.join('、')}（用 nh secret set 存进密钥库，或设同名环境变量）`,
    });
  }

  return {
    ok: !issues.some((i) => i.level === 'error'),
    issues,
    manifest,
    credentialsMissing,
  };
}
