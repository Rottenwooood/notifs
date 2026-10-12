import { ProducerManifestSchema, type ProducerManifest } from '@notify-hub/contracts';

export interface CheckIssue {
  level: 'error' | 'warn';
  message: string;
}

export interface CheckReport {
  ok: boolean;
  issues: CheckIssue[];
  manifest?: ProducerManifest;
  /** manifest 声明了、但中心环境里没有值的凭据名 */
  credentialsMissing: string[];
}

/** 生成代码里明显危险的操作（宽松检查，只告警不拦截）。 */
const SUSPICIOUS: { pattern: RegExp; message: string }[] = [
  { pattern: /\brm\s+-rf\s+\//, message: '代码里出现 rm -rf / 之类的高危删除' },
  { pattern: /\b(curl|wget)\b[^\n|]*\|\s*(sh|bash)\b/, message: '代码里出现 curl|sh 这类管道执行' },
  { pattern: /child_process|execSync|spawnSync/, message: '代码里出现子进程调用（请确认必要）' },
  { pattern: /process\.env\.NOTIFY_TOKEN\s*\)/, message: '疑似直接把口令写进日志' },
];

const KNOWN_INTERPRETERS = new Set(['node', 'python', 'python3', 'bash', 'sh', 'deno', 'bun']);

export function staticCheck(input: {
  files: Record<string, string>;
  existingSlugs: Set<string>;
  env: NodeJS.ProcessEnv;
}): CheckReport {
  const issues: CheckIssue[] = [];
  const { files } = input;

  const manifestText = files['producer.json'];
  if (manifestText === undefined) {
    issues.push({ level: 'error', message: '缺少 producer.json' });
    return { ok: false, issues, credentialsMissing: [] };
  }

  let manifest: ProducerManifest | undefined;
  try {
    manifest = ProducerManifestSchema.parse(JSON.parse(manifestText));
  } catch (err) {
    const detail = err instanceof Error ? err.message.split('\n')[0] : String(err);
    issues.push({ level: 'error', message: `producer.json 不合法：${detail}` });
  }

  if (manifest) {
    const hasCode = Object.keys(files).some(
      (f) => !['producer.json', 'README.md', 'package.json'].includes(f),
    );
    if (manifest.kind === 'managed' && !hasCode) {
      issues.push({ level: 'error', message: 'managed 程序没有任何代码文件' });
    }
    if (input.existingSlugs.has(manifest.slug)) {
      issues.push({ level: 'warn', message: `已有同名监控程序「${manifest.slug}」，上线会覆盖它` });
    }
    if (manifest.kind === 'managed') {
      const bin = manifest.command?.[0];
      if (bin && !KNOWN_INTERPRETERS.has(bin)) {
        issues.push({ level: 'warn', message: `启动命令的解释器「${bin}」不在常见白名单里，请人工确认` });
      }
    }
    for (const [path, content] of Object.entries(files)) {
      for (const s of SUSPICIOUS) {
        if (s.pattern.test(content)) issues.push({ level: 'warn', message: `${path}：${s.message}` });
      }
    }
  }

  const credentialsMissing: string[] = [];
  for (const name of manifest?.credentials ?? []) {
    if (!input.env[name] && !input.env[`NOTIFY_SECRET_${name}`]) credentialsMissing.push(name);
  }
  if (credentialsMissing.length > 0) {
    issues.push({
      level: 'warn',
      message: `这些凭据在中心环境里没有值：${credentialsMissing.join('、')}（上线前请设置，否则程序会以降级状态运行）`,
    });
  }

  return {
    ok: !issues.some((i) => i.level === 'error'),
    issues,
    ...(manifest ? { manifest } : {}),
    credentialsMissing,
  };
}
