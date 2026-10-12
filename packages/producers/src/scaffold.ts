import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ScaffoldOptions {
  slug: string;
  /** 显示名，默认用 slug */
  name?: string;
  /** managed（写代码）或 poller（写配置） */
  kind?: 'managed' | 'poller';
  /** 覆盖已存在目录 */
  force?: boolean;
}

// 生成的程序里一律用字符串拼接，避免与外层模板字面量互相转义。
const MANAGED_ENTRY = [
  '#!/usr/bin/env node',
  '// notify-hub 监控程序（managed）',
  '//',
  '// 中心会注入这些环境变量，你只管用：',
  '//   NOTIFY_BASE_URL      中心地址',
  '//   NOTIFY_TOKEN         你的身份 token',
  '//   NOTIFY_PRODUCER_ID   你的编号（发心跳用）',
  '//   NOTIFY_STATE_DIR     你独占的状态目录（放游标）',
  '//   NOTIFY_CONFIG        你在 producer.json 里写的 config（JSON 字符串）',
  '//',
  '// 契约全文见 docs/producer-protocol.md，要点：',
  '//   1. 发现变化 -> POST {NOTIFY_BASE_URL}/api/v1/events，信封 {type, text, ...}',
  '//   2. 每 30s 发一次心跳',
  '//   3. 断点写进 NOTIFY_STATE_DIR，重启能续上',
  '//   4. 异常别静默：用 degraded/error 心跳暴露出来',
  '//   5. 退出码 0 = 正常结束（不再重启）；非 0 = 异常（中心按退避重启）',
  '',
  "import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';",
  "import { join } from 'node:path';",
  '',
  'const BASE = process.env.NOTIFY_BASE_URL;',
  'const TOKEN = process.env.NOTIFY_TOKEN;',
  'const ID = process.env.NOTIFY_PRODUCER_ID;',
  'const STATE = process.env.NOTIFY_STATE_DIR;',
  "const CFG = JSON.parse(process.env.NOTIFY_CONFIG || '{}');",
  '',
  'const log = (...a) => console.log(new Date().toISOString(), ...a);',
  '',
  'async function post(path, body) {',
  '  const res = await fetch(BASE + path, {',
  "    method: 'POST',",
  "    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN },",
  '    body: JSON.stringify(body),',
  '  });',
  '  if (!res.ok) throw new Error(path + " -> HTTP " + res.status + " " + (await res.text()));',
  '  return res.json();',
  '}',
  '',
  'const heartbeat = (status, detail) =>',
  '  post("/api/v1/producers/" + ID + "/heartbeat", { status, detail }).catch(() => {});',
  '',
  'function loadState() {',
  '  try {',
  "    return JSON.parse(readFileSync(join(STATE, 'state.json'), 'utf8'));",
  '  } catch {',
  '    return {};',
  '  }',
  '}',
  'function saveState(s) {',
  '  mkdirSync(STATE, { recursive: true });',
  "  writeFileSync(join(STATE, 'state.json'), JSON.stringify(s));",
  '}',
  '',
  'const INTERVAL_MS = (CFG.intervalSeconds ?? 60) * 1000;',
  '',
  'async function checkOnce(state) {',
  '  // TODO 换成你的判定逻辑，例如：拉一个接口，把新条目当成"变化"。',
  '  //',
  '  //   const data = await (await fetch(CFG.url)).json();',
  '  //   for (const item of data.items ?? []) {',
  '  //     if (state.lastId && item.id <= state.lastId) continue;',
  '  //     state.lastId = item.id;',
  '  //     await post("/api/v1/events", {',
  '  //       type: CFG.type ?? "app.' + '${SLUG}' + '.changed",',
  '  //       text: String(item.title ?? item.id),',
  '  //       dedup_key: (CFG.type ?? "item") + ":" + item.id,',
  '  //     });',
  '  //   }',
  '  //   saveState(state);',
  '  void state;',
  '  return 0;',
  '}',
  '',
  'async function main() {',
  "  log('启动', { base: BASE, cfg: CFG });",
  "  const hb = setInterval(() => heartbeat('ok'), 30_000);",
  '  hb.unref?.();',
  "  await heartbeat('ok', '启动');",
  '',
  '  const state = loadState();',
  '  for (;;) {',
  '    try {',
  '      const n = await checkOnce(state);',
  '      if (n > 0) log("上报 " + n + " 条");',
  '    } catch (err) {',
  "      log('异常:', err.message);",
  "      await heartbeat('degraded', err.message);",
  '    }',
  '    await new Promise((r) => setTimeout(r, INTERVAL_MS));',
  '  }',
  '}',
  '',
  'main().catch(async (err) => {',
  "  await heartbeat('error', String(err));",
  '  process.exit(1);',
  '});',
  '',
].join('\n');

const README = (slug: string, kind: string) =>
  [
    `# ${slug}`,
    '',
    '由 `pnpm cli producer init` 生成。',
    '',
    `- 类型：${kind}`,
    '- 改 `producer.json` 里的 `config` 填你的参数；需要密钥就写进 `credentials`（值用 `pnpm cli secret set` 存进中心）',
    kind === 'managed' ? '- 改 `index.mjs` 里的 `TODO` 换成你的判定逻辑' : '- 直接在 `producer.json` 的 `poller` 字段里写轮询配置',
    '',
    '上线前先自检：',
    '',
    '```sh',
    `pnpm cli producer check ${slug}      # 静态校验`,
    `pnpm cli producer try   ${slug}      # 试运行：只打印"将会上报什么"`,
    `pnpm cli producer enable ${slug}     # 上线`,
    '```',
    '',
    '契约全文：`docs/producer-protocol.md`',
    '',
  ].join('\n');

/** 生成一个监控程序目录骨架，交给外部（你或你的 agent）填逻辑。 */
export function scaffoldProducer(parentDir: string, opts: ScaffoldOptions): string {
  const kind = opts.kind ?? 'managed';
  const dir = join(parentDir, opts.slug);
  if (existsSync(dir) && !opts.force) {
    throw new Error(`目录已存在：${dir}（要覆盖就加 --force）`);
  }
  mkdirSync(dir, { recursive: true });

  const manifest: Record<string, unknown> = {
    name: opts.name ?? opts.slug,
    slug: opts.slug,
    kind,
    description: `${opts.slug} 监控程序`,
    enabled: false,
    interval: '60s',
    credentials: [],
    config: {},
  };
  if (kind === 'managed') {
    manifest['command'] = ['node', 'index.mjs'];
  } else {
    manifest['poller'] = {
      interval: '60s',
      request: { url: 'https://example.com/api', method: 'GET' },
      extract: '$[*]',
      key: '$.id',
      change: { on: 'new_item' },
      map: { type: '"app.changed"', text: '$.title', dedup_key: '"item:{{ id }}"' },
    };
  }

  writeFileSync(join(dir, 'producer.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(dir, 'README.md'), README(opts.slug, kind));
  if (kind === 'managed') {
    writeFileSync(join(dir, 'index.mjs'), MANAGED_ENTRY.replaceAll('${SLUG}', opts.slug));
  }
  return dir;
}
