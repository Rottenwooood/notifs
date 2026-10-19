#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { Authoring, createOpenAiCompatibleProvider } from '@notify-hub/authoring';
import { PRODUCER_PROTOCOL } from '@notify-hub/contracts';
import { hashPassword, loadOrCreateMasterKey, openStore, SecretBox } from '@notify-hub/store';
import { checkProducerDir, scaffoldProducer, syncProducers, trialRun } from '@notify-hub/producers';
import { loadConfig, loadLlmConfig } from '@notify-hub/server/config';

/** 极简 argv 解析：位置参数 + --key value / --flag。 */
interface Args {
  positional: string[];
  flags: Record<string, string | true>;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function flagStr(flags: Record<string, string | true>, key: string): string | undefined {
  const v = flags[key];
  return typeof v === 'string' ? v : undefined;
}

function openDb() {
  const config = loadConfig();
  const store = openStore(config.dbPath);
  store.migrate();
  return { store, config };
}

function json<T>(s: string | undefined, fallback: T): T {
  if (!s) return fallback;
  return JSON.parse(s) as T;
}

function print(obj: unknown): void {
  console.log(JSON.stringify(obj, null, 2));
}

/** 打开加密密钥库（主密钥在数据目录）。 */
function secretBoxFor(store: ReturnType<typeof openDb>['store'], config: ReturnType<typeof loadConfig>) {
  return new SecretBox(store, loadOrCreateMasterKey(join(config.dataDir, 'master.key')));
}

/** 默认 agent 的 token 文件（notifs init 写入）。 */
function tokenFile(config: ReturnType<typeof loadConfig>): string {
  return join(config.configDir, 'token');
}

/** 只认"这一次安装"的 token：环境变量 → 配置目录里的 token 文件。 */
function tokenFromFile(config: ReturnType<typeof loadConfig>): string | undefined {
  const fromEnv = process.env['NOTIFS_TOKEN'] ?? process.env['NOTIFY_TOKEN'];
  if (fromEnv) return fromEnv;
  try {
    const t = readFileSync(tokenFile(config), 'utf8').trim();
    if (t) return t;
  } catch {
    /* 没有就算了 */
  }
  return undefined;
}

/** 读 token：先看本次安装，再兼容旧的 notify-hub 路径。 */
function readToken(config: ReturnType<typeof loadConfig>): string | undefined {
  const t = tokenFromFile(config);
  if (t) return t;
  try {
    const legacy = readFileSync(join(homedir(), '.config/notify-hub/token'), 'utf8').trim();
    if (legacy) return legacy;
  } catch {
    /* 没有就算了 */
  }
  return undefined;
}

/** dist/server.mjs 与 CLI 同目录（打包后）；开发态没有。 */
function bundledServer(): string | undefined {
  try {
    const p = fileURLToPath(new URL('./server.mjs', import.meta.url));
    return existsSync(p) ? p : undefined;
  } catch {
    return undefined;
  }
}

function runChild(command: string, args: string[]): never {
  const child = spawn(command, args, { stdio: 'inherit' });
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
  // 保持进程存活直到子进程退出
  return undefined as never;
}

function printCheck(check: { ok: boolean; issues: { level: string; message: string }[] }): void {
  if (check.issues.length === 0) {
    console.log('检查：通过（无问题）');
    return;
  }
  console.log(`检查：${check.ok ? '通过（有提醒）' : '未通过'}`);
  for (const i of check.issues) console.log(`  [${i.level === 'error' ? '错误' : '提醒'}] ${i.message}`);
}

const PROTOCOL_DOC_PATH = (): string =>
  process.env['NOTIFY_PROTOCOL_DOC'] ?? resolve(process.cwd(), 'docs/producer-protocol.md');

/** 构造 Authoring；只有"生成"需要模型，查看/检查/试运行/审批都不需要。 */
function makeAuthoring(
  store: ReturnType<typeof openDb>['store'],
  config: ReturnType<typeof loadConfig>,
) {
  const llm = loadLlmConfig();
  let protocolDoc = '';
  try {
    protocolDoc = readFileSync(PROTOCOL_DOC_PATH(), 'utf8');
  } catch {
    /* 生成时若缺失会由模型报错暴露；其它子命令不需要它 */
  }
  return new Authoring(store, {
    draftsDir: config.draftsDir,
    producersDir: config.producersDir,
    dataDir: config.dataDir,
    ...(llm ? { provider: createOpenAiCompatibleProvider(llm) } : {}),
    protocolDoc,
  });
}

const HELP = `notifs（本机通知中继）

  安装 / 运行
    init                                        初始化数据目录 + agent token
    start                                       前台启动中心
    install-service [--print]                   写 systemd 用户服务并开机自启
    mcp                                         以 MCP（stdio）方式接给 agent
    contract                                    打印接入契约
    notify "<正文>" [--type t] [--title ...]    快速发一条通知

  status                                        一眼看全部：源/出口/规则/程序/投递/密钥
  events [--limit <n>]                          看最近的事件流

  信息源（外部程序的身份）
    source add <name> [--dedup-ttl <秒>]        新建并打印 token（只显示一次）
    source list | enable <name> | disable <name> | rm <name>
    source token <name>                         重置并打印新 token

  出口（提醒发到哪）
    channel add <name> --kind <kind> [--config <json>]
    channel list | enable <name> | disable <name> | rm <name>
    （kind: local | webhook | ntfy | bark | wecom | feishu | feishu-app）

  规则（什么情况走哪个出口）
    rule add --name <name> --when <json> --actions <json> [--priority <n>] [--exclusive]
    rule list | enable <name> | disable <name> | rm --name <name>

  监控程序（你自己或你的 agent 写的；旧名 monitor / producer 仍可用）
    watcher init <slug> [--kind managed|poller] [--name <显示名>] [--force]
    watcher check <slug>                        静态校验（清单/入口/解释器/凭据）
    watcher try <slug> [--seconds 15]           试运行：真跑一遍，只打印"将会上报什么"
    watcher sync                                扫描 producers/*/producer.json 同步进 DB
    watcher list | enable <slug> | disable <slug> | logs <slug> [--tail 80]
    watcher rm <slug> [--dir]                   注销（--dir 连目录一起删）

  凭据 / 运维
    secret set <名称> [--value <值>]            加密保存（不给 --value 则从 stdin 读）
    secret list | rm <名称>
    backup [--to <目录>]                        一致性备份（数据库快照 + 主密钥）
    user init | passwd                          （仅 Web 界面需要；纯 CLI 用法可不用）

  测试与调试
    emit --server <base> --token <t> --type <type> --text <text> [--title] [--url] [--dedup-key] [--data]
    deliveries [--status <s>] [--limit <n>] | deliveries retry <id>
    dev-seed [--webhook <url>]

  Agent 生成（可选，需要配模型；不依赖它也能用上面的 producer 流程）
    author new "<需求>" | list | show <slug> | check <slug> | try <slug> | approve <slug> | reject <slug>
    llm check
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { positional, flags } = parseArgs(argv);
  const [cmd, sub] = positional;

  // "监控程序"子命令：规范名 watcher；monitor / producer 保留为别名
  const MONITOR_SUBCMDS = new Set(['watcher', 'monitor', 'producer']);
  const isMonitor = cmd !== undefined && MONITOR_SUBCMDS.has(cmd);

  if (!cmd || cmd === 'help' || flags['help']) {
    console.log(HELP);
    return;
  }

  // ---------------------------------------------------------- 安装版入口

  if (cmd === 'start') {
    const server = bundledServer();
    if (server) {
      spawn(process.execPath, [server], { stdio: 'inherit' }).on('exit', (code, signal) =>
        process.exit(code ?? (signal ? 1 : 0)),
      );
      return;
    }
    const script = resolve(process.cwd(), 'tools/run.sh');
    if (!existsSync(script)) throw new Error('找不到 server 入口（dist/server.mjs 或 tools/run.sh）');
    spawn('bash', [script], { stdio: 'inherit' }).on('exit', (code, signal) =>
      process.exit(code ?? (signal ? 1 : 0)),
    );
    return;
  }

  if (cmd === 'mcp') {
    const config = loadConfig();
    const token = readToken(config);
    if (!token) {
      // stdout 是 MCP 协议通道，这里只能用 stderr
      console.error('没有 token。先跑 `notifs init`，或设置 NOTIFS_TOKEN。');
      process.exit(1);
    }
    const { startMcp } = await import('@notify-hub/mcp');
    await startMcp({ baseUrl: config.baseUrl, token });
    return;
  }

  if (cmd === 'contract') {
    console.log(PRODUCER_PROTOCOL);
    return;
  }

  if (cmd === 'notify') {
    const config = loadConfig();
    const token = readToken(config);
    if (!token) throw new Error('没有 token。先跑 `notifs init`，或设置 NOTIFS_TOKEN。');
    const text = positional.slice(1).join(' ').trim();
    if (!text) {
      throw new Error(
        '用法: notifs notify "要通知的内容" [--type t] [--title ...] [--severity warn] [--url ...] [--dedup-key ...]',
      );
    }
    const body: Record<string, unknown> = { type: flagStr(flags, 'type') ?? 'note', text };
    const title = flagStr(flags, 'title');
    if (title) body['title'] = title;
    const url = flagStr(flags, 'url');
    if (url) body['url'] = url;
    const severity = flagStr(flags, 'severity');
    if (severity) body['severity'] = severity;
    const dedup = flagStr(flags, 'dedup-key');
    if (dedup) body['dedup_key'] = dedup;
    const data = flagStr(flags, 'data');
    if (data) body['data'] = JSON.parse(data);

    const res = await fetch(`${config.baseUrl}/api/v1/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const out = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${out.error ?? ''}`);
    print(out);
    return;
  }

  if (cmd === 'init') {
    const config = loadConfig();
    mkdirSync(config.configDir, { recursive: true, mode: 0o700 });
    mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    const store = openStore(config.dbPath);
    store.migrate();
    loadOrCreateMasterKey(join(config.dataDir, 'master.key'));

    let token = tokenFromFile(config);
    let created = false;
    let rotated = false;
    const existing = store.getSourceByName('agent');
    if (!existing) {
      const r = store.createSource({ name: 'agent' });
      token = r.token;
      writeFileSync(tokenFile(config), `${token}\n`, { mode: 0o600 });
      created = true;
    } else if (!token) {
      // 源在、token 丢了（token 只存哈希，找不回来）→ 只能轮换
      token = store.resetSourceToken(existing.id);
      writeFileSync(tokenFile(config), `${token}\n`, { mode: 0o600 });
      rotated = true;
    }
    print({
      dataDir: config.dataDir,
      configDir: config.configDir,
      db: config.dbPath,
      baseUrl: config.baseUrl,
      tokenFile: tokenFile(config),
    });
    if (created) console.log('\n已创建源 `agent`，token 写入上面那个文件（600）。');
    if (rotated) console.log('\n源 `agent` 已存在但没有 token 文件，已轮换 token（旧的使用方会失效）。');
    console.log(`
下一步：
  1. 建出口（Linux 桌面）：notifs channel add desktop --kind local --config '{}'
     或（飞书群机器人）：  notifs channel add feishu --kind feishu --config '{"webhook":"https://open.feishu.cn/open-apis/bot/v2/hook/..."}'
  2. 建规则（全部事件 → 这个出口）：notifs rule add --name '全部' --when '{}' --actions '[{"channel":"desktop"}]'
  3. 开机自启：notifs install-service
  4. 冒烟：notifs notify "hello"`);
    store.close();
    return;
  }

  if (cmd === 'install-service') {
    const config = loadConfig();
    const server = bundledServer();
    if (!server) throw new Error('找不到 dist/server.mjs —— 先 `npm i -g notifs`（或在打包产物里运行）');

    const unit = `[Unit]
Description=notifs 通知中继
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${process.execPath} ${server}
EnvironmentFile=-${join(config.configDir, 'env')}
Restart=always
RestartSec=3
KillSignal=SIGTERM
TimeoutStopSec=20

[Install]
WantedBy=default.target
`;

    if (flags['print']) {
      console.log(unit);
      return;
    }

    const dir = join(homedir(), '.config/systemd/user');
    mkdirSync(dir, { recursive: true });
    if (existsSync(join(dir, 'notify-hub.service'))) {
      console.log('注意：检测到旧的 notify-hub.service。两者会抢同一个端口，先：');
      console.log('  systemctl --user disable --now notify-hub\n');
    }
    writeFileSync(join(dir, 'notifs.service'), unit);
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
    execFileSync('systemctl', ['--user', 'enable', '--now', 'notifs.service'], { stdio: 'inherit' });
    console.log('已安装并启动。看状态：systemctl --user status notifs');
    return;
  }

  if (cmd === 'migrate') {
    const { store, config } = openDb();
    console.log(`已迁移: ${config.dbPath}`);
    store.close();
    return;
  }

  if (cmd === 'source' && sub === 'add') {
    const name = positional[2];
    if (!name) throw new Error('用法: source add <name>');
    const { store } = openDb();
    const { source, token } = store.createSource({
      name,
      dedupTtlSec: Number(flagStr(flags, 'dedup-ttl') ?? 86400),
    });
    print({ id: source.id, name: source.name, token });
    console.log('\n把上面的 token 填进源的 webhook / 监控程序配置。');
    store.close();
    return;
  }

  if (cmd === 'source' && sub === 'list') {
    const { store } = openDb();
    print(store.listSources().map((s) => ({ id: s.id, name: s.name, kind: s.kind, enabled: s.enabled })));
    store.close();
    return;
  }

  if (cmd === 'source' && (sub === 'enable' || sub === 'disable')) {
    const name = positional[2];
    if (!name) throw new Error(`用法: source ${sub} <名字>`);
    const { store } = openDb();
    const s = store.getSourceByName(name);
    if (!s) throw new Error(`没有这个信息源：${name}`);
    store.setSourceEnabled(s.id, sub === 'enable');
    console.log(`${name} → ${sub === 'enable' ? '启用' : '停用'}`);
    store.close();
    return;
  }

  if (cmd === 'source' && (sub === 'rm' || sub === 'remove')) {
    const name = positional[2];
    if (!name) throw new Error('用法: source rm <名字>');
    const { store } = openDb();
    const s = store.getSourceByName(name);
    if (!s) throw new Error(`没有这个信息源：${name}`);
    store.deleteSource(s.id);
    console.log(`已删除信息源：${name}`);
    store.close();
    return;
  }

  if (cmd === 'source' && (sub === 'token' || sub === 'reset')) {
    const name = positional[2];
    if (!name) throw new Error('用法: source token <名字>   （重置并打印新 token）');
    const { store } = openDb();
    const s = store.getSourceByName(name);
    if (!s) throw new Error(`没有这个信息源：${name}`);
    const token = store.resetSourceToken(s.id);
    print({ name, token });
    console.log('旧 token 已失效。');
    store.close();
    return;
  }

  if (cmd === 'channel' && sub === 'add') {
    const name = positional[2];
    const kind = flagStr(flags, 'kind');
    if (!name || !kind) throw new Error('用法: channel add <name> --kind <kind> [--config <json>]');
    const { store } = openDb();
    const row = store.upsertChannel({ name, kind, config: json(flagStr(flags, 'config'), {}) });
    print({ id: row.id, name: row.name, kind: row.kind });
    store.close();
    return;
  }

  if (cmd === 'channel' && sub === 'list') {
    const { store } = openDb();
    print(store.listChannels().map((c) => ({ id: c.id, name: c.name, kind: c.kind, enabled: c.enabled })));
    store.close();
    return;
  }

  if (cmd === 'channel' && (sub === 'enable' || sub === 'disable')) {
    const name = positional[2];
    if (!name) throw new Error(`用法: channel ${sub} <名字>`);
    const { store } = openDb();
    const c = store.getChannelByName(name);
    if (!c) throw new Error(`没有这个出口：${name}`);
    store.setChannelEnabled(c.id, sub === 'enable');
    console.log(`${name} → ${sub === 'enable' ? '启用' : '停用'}`);
    store.close();
    return;
  }

  if (cmd === 'channel' && (sub === 'rm' || sub === 'remove')) {
    const name = positional[2];
    if (!name) throw new Error('用法: channel rm <名字>');
    const { store } = openDb();
    const c = store.getChannelByName(name);
    if (!c) throw new Error(`没有这个出口：${name}`);
    store.deleteChannel(c.id);
    console.log(`已删除出口：${name}`);
    store.close();
    return;
  }

  if (cmd === 'rule' && sub === 'add') {
    const name = flagStr(flags, 'name');
    if (!name) throw new Error('用法: rule add --name <name> --when <json> --actions <json>');
    const { store } = openDb();
    const row = store.upsertRule({
      name,
      priority: Number(flagStr(flags, 'priority') ?? 100),
      when: json(flagStr(flags, 'when'), {}),
      behavior: flags['exclusive'] ? { exclusive: true } : undefined,
      actions: json(flagStr(flags, 'actions'), []),
    });
    print({ id: row.id, name: row.name, priority: row.priority });
    store.close();
    return;
  }

  if (cmd === 'rule' && sub === 'list') {
    const { store } = openDb();
    print(store.listEnabledRules().map((r) => ({ id: r.id, name: r.name, when: r.whenJson, actions: r.actionsJson })));
    store.close();
    return;
  }

  if (cmd === 'rule' && (sub === 'enable' || sub === 'disable')) {
    const name = flagStr(flags, 'name') ?? positional[2];
    if (!name) throw new Error(`用法: rule ${sub} --name <名字>`);
    const { store } = openDb();
    const r = store.getRuleByName(name);
    if (!r) throw new Error(`没有这条规则：${name}`);
    store.setRuleEnabled(r.id, sub === 'enable');
    console.log(`${name} → ${sub === 'enable' ? '启用' : '停用'}`);
    store.close();
    return;
  }

  if (cmd === 'rule' && (sub === 'rm' || sub === 'remove')) {
    const name = flagStr(flags, 'name') ?? positional[2];
    if (!name) throw new Error('用法: rule rm --name <名字>');
    const { store } = openDb();
    const r = store.getRuleByName(name);
    if (!r) throw new Error(`没有这条规则：${name}`);
    store.deleteRule(r.id);
    console.log(`已删除规则：${name}`);
    store.close();
    return;
  }

  if (isMonitor && sub === 'sync') {
    const { store, config } = openDb();
    const result = syncProducers(store, { producersDir: config.producersDir, dataDir: config.dataDir });
    print(result.entries);
    for (const e of result.errors) console.error(`[!] ${e.dir}: ${e.error}`);
    console.log('\n（运行中的 server 需要重启或重新加载才能拉起新程序）');
    store.close();
    return;
  }

  if (isMonitor && sub === 'list') {
    const { store } = openDb();
    print(
      store.listProducers().map((p) => ({
        slug: store.getSourceById(p.sourceId)?.name ?? p.sourceId,
        kind: p.kind,
        enabled: p.enabled,
        status: p.status,
        pid: p.pid,
        restarts: p.restartCount,
        lastError: p.lastError,
      })),
    );
    store.close();
    return;
  }

  if (isMonitor && (sub === 'enable' || sub === 'disable')) {
    const slug = positional[2];
    if (!slug) throw new Error(`用法: producer ${sub} <slug>`);
    const { store } = openDb();
    const p = store.getProducerBySlug(slug);
    if (!p) throw new Error(`没有名为 ${slug} 的监控程序（先 monitor sync）`);
    store.setProducerEnabled(p.id, sub === 'enable');
    print({ slug, enabled: sub === 'enable' });
    console.log('（运行中的 server 需重新加载才会启停：重启 service，或等 reconcile）');
    store.close();
    return;
  }

  if (isMonitor && sub === 'logs') {
    const slug = positional[2];
    if (!slug) throw new Error('用法: producer logs <slug>');
    const { config } = openDb();
    const file = `${config.dataDir}/producers/${slug}/hub.log`;
    const tail = Number(flagStr(flags, 'tail') ?? 80);
    try {
      const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
      console.log(lines.slice(-tail).join('\n'));
    } catch {
      console.error(`没有日志：${file}（该程序可能从未运行）`);
    }
    return;
  }

  if (cmd === 'author' && sub === 'new') {
    const requirement = (positional.slice(2).join(' ') || flagStr(flags, 'req') || '').trim();
    if (!requirement) throw new Error('用法: author new "<需求描述>"');
    const { store, config } = openDb();
    const authoring = makeAuthoring(store, config);
    const result = await authoring.generate(requirement);
    if (result.status === 'clarify') {
      console.log('模型认为信息不足，需要先澄清：');
      for (const q of result.questions) console.log(`  - ${q}`);
      console.log('\n补充信息后重新执行 author new。');
      store.close();
      return;
    }
    console.log(`草稿已生成：${result.meta.slug}`);
    console.log(`文件：${result.meta.files.join('、')}`);
    console.log(`提供方：${result.meta.provider}`);
    printCheck(authoring.check(result.meta.slug));
    console.log(`\n下一步：nh author show ${result.meta.slug}  →  author try  →  author approve`);
    store.close();
    return;
  }

  if (cmd === 'author' && sub === 'list') {
    const { store, config } = openDb();
    const authoring = makeAuthoring(store, config);
    print(
      authoring.listDrafts().map((d) => ({
        slug: d.slug,
        status: d.status,
        createdAt: d.createdAt,
        requirement: d.requirement.slice(0, 60),
      })),
    );
    store.close();
    return;
  }

  if (cmd === 'author' && sub === 'show') {
    const slug = positional[2];
    if (!slug) throw new Error('用法: author show <slug>');
    const { store, config } = openDb();
    const authoring = makeAuthoring(store, config);
    const meta = authoring.getDraft(slug);
    if (!meta) throw new Error(`没有草稿：${slug}`);
    print(meta);
    const files = authoring.readFiles(slug);
    for (const [path, content] of Object.entries(files)) {
      console.log(`\n===== ${path} =====\n${content.replace(/\s+$/, '')}`);
    }
    store.close();
    return;
  }

  if (cmd === 'author' && sub === 'check') {
    const slug = positional[2];
    if (!slug) throw new Error('用法: author check <slug>');
    const { store, config } = openDb();
    const authoring = makeAuthoring(store, config);
    printCheck(authoring.check(slug));
    store.close();
    return;
  }

  if (cmd === 'author' && sub === 'try') {
    const slug = positional[2];
    if (!slug) throw new Error('用法: author try <slug> [--seconds 15]');
    const { store, config } = openDb();
    const authoring = makeAuthoring(store, config);
    const seconds = Number(flagStr(flags, 'seconds') ?? 15);
    console.log(`试运行 ${seconds}s（事件会被拦下，不会真的入库/通知）…`);
    const r = await authoring.trial(slug, { timeoutMs: seconds * 1000 });
    console.log(
      `\n耗时 ${(r.durationMs / 1000).toFixed(1)}s，退出=${r.exitCode ?? r.signal}，心跳 ${r.heartbeatCount} 次`,
    );
    console.log(`将会上报 ${r.events.length} 条事件：`);
    print(r.events);
    if (r.stdout.trim()) console.log(`--- 程序输出 ---\n${r.stdout.trim()}`);
    if (r.stderr.trim()) console.log(`--- 程序错误 ---\n${r.stderr.trim()}`);
    console.log(`\n确认无误后：nh author approve ${slug}`);
    store.close();
    return;
  }

  if (cmd === 'author' && sub === 'approve') {
    const slug = positional[2];
    if (!slug) throw new Error('用法: author approve <slug>');
    const { store, config } = openDb();
    const authoring = makeAuthoring(store, config);
    const meta = authoring.approve(slug);
    console.log(`已上线：${meta.slug}（已复制到监控程序区并启用）`);
    console.log('运行中的 server 会在检测到目录变化后自动拉起它；没在跑的话下次启动即可。');
    store.close();
    return;
  }

  if (cmd === 'author' && sub === 'reject') {
    const slug = positional[2];
    if (!slug) throw new Error('用法: author reject <slug> --reason "..."');
    const { store, config } = openDb();
    const authoring = makeAuthoring(store, config);
    const meta = authoring.reject(slug, flagStr(flags, 'reason') ?? '未说明');
    console.log(`已驳回：${meta.slug}`);
    store.close();
    return;
  }

  if (cmd === 'user' && sub === 'init') {
    const username = flagStr(flags, 'username') ?? 'admin';
    const password = flagStr(flags, 'password') ?? readFileSync(0, 'utf8').trim();
    if (!password) throw new Error('用法: user init --username admin --password <口令>（或从 stdin 读）');
    const { store } = openDb();
    if (store.countUsers() > 0) throw new Error('已存在用户；改口令请用 user passwd');
    const user = store.createUser(username, hashPassword(password));
    console.log(`已创建用户：${user.username}（可用于登录管理界面）`);
    store.close();
    return;
  }

  if (cmd === 'user' && sub === 'passwd') {
    const username = flagStr(flags, 'username') ?? 'admin';
    const password = flagStr(flags, 'password') ?? readFileSync(0, 'utf8').trim();
    if (!password) throw new Error('用法: user passwd [--username admin] --password <口令>（或从 stdin 读）');
    const { store } = openDb();
    const user = store.getUserByName(username);
    if (!user) throw new Error(`没有用户：${username}`);
    store.updateUserPassword(user.id, hashPassword(password));
    console.log(`已更新口令：${username}`);
    store.close();
    return;
  }

  if (cmd === 'secret' && sub === 'set') {
    const name = positional[2];
    if (!name) throw new Error('用法: secret set <名称> --value <值>（或从 stdin 读）');
    const value = flagStr(flags, 'value') ?? readFileSync(0, 'utf8').trim();
    if (!value) throw new Error('值不能为空');
    const { store, config } = openDb();
    const box = new SecretBox(store, loadOrCreateMasterKey(join(config.dataDir, 'master.key')));
    box.set(name, value);
    console.log(`已加密保存：${name}`);
    store.close();
    return;
  }

  if (cmd === 'secret' && sub === 'list') {
    const { store, config } = openDb();
    const box = new SecretBox(store, loadOrCreateMasterKey(join(config.dataDir, 'master.key')));
    print(box.names());
    store.close();
    return;
  }

  if (cmd === 'secret' && (sub === 'rm' || sub === 'remove')) {
    const name = positional[2];
    if (!name) throw new Error('用法: secret rm <名称>');
    const { store, config } = openDb();
    const box = new SecretBox(store, loadOrCreateMasterKey(join(config.dataDir, 'master.key')));
    box.remove(name);
    console.log(`已删除：${name}`);
    store.close();
    return;
  }

  if (cmd === 'llm' && sub === 'check') {
    const llm = loadLlmConfig();
    if (!llm) {
      console.error('未配置 LLM：需要 NOTIFY_LLM_MODEL（可选 NOTIFY_LLM_BASE_URL / NOTIFY_LLM_API_KEY）');
      process.exit(1);
    }
    console.log(`base=${llm.baseUrl}`);
    console.log(`model=${llm.model}`);
    console.log(`key=${llm.apiKey ? `已提供（${llm.apiKey.slice(0, 6)}…，${llm.apiKey.length} 字符）` : '未提供'}`);

    try {
      const res = await fetch(`${llm.baseUrl}/models`, {
        headers: llm.apiKey ? { authorization: `Bearer ${llm.apiKey}` } : {},
      });
      const body = await res.text();
      if (res.ok) {
        const ids = (JSON.parse(body) as { data?: { id?: string }[] }).data?.map((m) => m.id) ?? [];
        console.log(`GET /models → ok，${ids.length} 个模型${ids.length ? `：${ids.slice(0, 15).join(', ')}` : ''}`);
        if (ids.length && !ids.includes(llm.model)) {
          console.log(`[提醒] 配置的模型名「${llm.model}」不在列表里，请核对`);
        }
      } else {
        console.log(`GET /models → HTTP ${res.status}：${body.slice(0, 300)}`);
      }
    } catch (err) {
      console.log(`GET /models → 请求失败：${(err as Error).message}`);
    }

    try {
      const provider = createOpenAiCompatibleProvider(llm);
      const content = await provider.complete([{ role: 'user', content: '只回复两个字：可用' }], {
        timeoutMs: 30_000,
      });
      console.log(`chat/completions → ok：${content.trim().slice(0, 60)}`);
    } catch (err) {
      console.log(`chat/completions → 失败：${(err as Error).message}`);
      process.exitCode = 1;
    }
    return;
  }

  if (cmd === 'backup') {
    const { store, config } = openDb();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const to = flagStr(flags, 'to') ?? `${config.dataDir}/backups/${stamp}`;
    mkdirSync(to, { recursive: true });
    const dbOut = `${to}/notify-hub.db`;
    store.db.exec(`VACUUM INTO '${dbOut.replace(/'/g, "''")}'`);
    const keyPath = `${config.dataDir}/master.key`;
    let keyCopied = false;
    if (existsSync(keyPath)) {
      copyFileSync(keyPath, `${to}/master.key`);
      keyCopied = true;
    }
    store.close();
    print({ to, db: dbOut, masterKeyCopied: keyCopied });
    console.log('\n提示：master.key 是解密凭据的唯一钥匙，务必和备份一起妥善保存。');
    return;
  }

  if (isMonitor && (sub === 'rm' || sub === 'remove')) {
    const slug = positional[2];
    if (!slug) throw new Error('用法: producer rm <slug> [--dir]');
    const { store, config } = openDb();
    const p = store.getProducerBySlug(slug);
    if (p) {
      store.deleteProducer(p.id);
      console.log(`已移除程序记录：${slug}`);
    } else {
      console.log(`（没有 ${slug} 的登记记录，可能还没 monitor sync）`);
    }
    const dir = join(config.producersDir, slug);
    if (flags['dir'] === true && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      console.log(`已删除目录：${dir}`);
    } else if (existsSync(dir)) {
      console.log(`目录仍在：${dir}（加 --dir 可一并删除）`);
    }
    store.close();
    return;
  }

  if (isMonitor && sub === 'init') {
    const slug = positional[2];
    if (!slug) throw new Error('用法: producer init <slug> [--kind managed|poller] [--name <显示名>] [--force]');
    const { config } = openDb();
    const kind = (flagStr(flags, 'kind') as 'managed' | 'poller' | undefined) ?? 'managed';
    const name = flagStr(flags, 'name');
    const dir = scaffoldProducer(config.producersDir, {
      slug,
      kind,
      ...(name ? { name } : {}),
      force: flags['force'] === true,
    });
    console.log(`已生成骨架：${dir}`);
    console.log('下一步：编辑里面的 producer.json / index.mjs，然后：');
    console.log(`  nh watcher check  ${slug}`);
    console.log(`  nh watcher try    ${slug}`);
    console.log(`  nh watcher enable ${slug}`);
    return;
  }

  if (isMonitor && sub === 'check') {
    const slug = positional[2];
    if (!slug) throw new Error('用法: producer check <slug>');
    const { store, config } = openDb();
    const box = secretBoxFor(store, config);
    const report = checkProducerDir(join(config.producersDir, slug), {
      resolveSecret: (n) => box.resolve(n),
    });
    printCheck(report);
    store.close();
    process.exitCode = report.ok ? 0 : 1;
    return;
  }

  if (isMonitor && sub === 'try') {
    const slug = positional[2];
    if (!slug) throw new Error('用法: producer try <slug> [--seconds 15]');
    const { store, config } = openDb();
    const dir = join(config.producersDir, slug);
    let manifest: { command?: string[]; credentials?: string[] } & Record<string, unknown>;
    try {
      manifest = JSON.parse(readFileSync(join(dir, 'producer.json'), 'utf8'));
    } catch {
      throw new Error(`读不到 ${join(dir, 'producer.json')}`);
    }
    if (!manifest.command?.length) {
      throw new Error('该程序没有 command（poller 不需要试运行，直接 producer enable）');
    }
    const box = secretBoxFor(store, config);
    const extraEnv: Record<string, string> = {};
    for (const n of manifest.credentials ?? []) {
      const v = box.resolve(n);
      if (v !== undefined) extraEnv[n] = v;
    }
    const seconds = Number(flagStr(flags, 'seconds') ?? 15);
    console.log(`试运行 ${seconds}s（事件会被拦下：不入库、不通知）…`);
    const r = await trialRun(dir, manifest as never, {
      timeoutMs: seconds * 1000,
      baseEnv: process.env,
      extraEnv,
    });
    console.log(`\n耗时 ${(r.durationMs / 1000).toFixed(1)}s，退出=${r.exitCode ?? r.signal}，心跳 ${r.heartbeatCount} 次`);
    console.log(`将会上报 ${r.events.length} 条事件：`);
    print(r.events);
    if (r.stdout.trim()) console.log(`--- 程序输出 ---\n${r.stdout.trim()}`);
    if (r.stderr.trim()) console.log(`--- 程序错误 ---\n${r.stderr.trim()}`);
    store.close();
    return;
  }

  if (cmd === 'status') {
    const { store } = openDb();
    print({
      sources: store.listSources().map((s) => ({ name: s.name, kind: s.kind, enabled: s.enabled })),
      channels: store.listChannels().map((c) => ({ name: c.name, kind: c.kind, enabled: c.enabled })),
      rules: store.listRules().map((r) => ({
        name: r.name,
        enabled: r.enabled,
        when: JSON.parse(r.whenJson),
        actions: JSON.parse(r.actionsJson),
      })),
      producers: store.listProducers().map((p) => ({
        slug: store.getSourceById(p.sourceId)?.name ?? p.sourceId,
        kind: p.kind,
        enabled: p.enabled,
        status: p.status,
        restarts: p.restartCount,
        lastError: p.lastError,
      })),
      deliveries: store.deliveryStats(),
      secrets: store.listSecretNames(),
    });
    store.close();
    return;
  }

  if (cmd === 'events') {
    const { store } = openDb();
    const limit = Number(flagStr(flags, 'limit') ?? 20);
    print(store.listEvents(Number.isFinite(limit) ? limit : 20));
    store.close();
    return;
  }

  if (cmd === 'emit') {
    const base = flagStr(flags, 'server') ?? 'http://127.0.0.1:7710';
    const token = flagStr(flags, 'token');
    const type = flagStr(flags, 'type');
    const text = flagStr(flags, 'text');
    if (!token || !type || !text) throw new Error('用法: emit --server <base> --token <t> --type <type> --text <text>');
    const body: Record<string, unknown> = { type, text };
    const title = flagStr(flags, 'title');
    if (title) body['title'] = title;
    const url = flagStr(flags, 'url');
    if (url) body['url'] = url;
    const dedup = flagStr(flags, 'dedup-key');
    if (dedup) body['dedup_key'] = dedup;
    const data = flagStr(flags, 'data');
    if (data) body['data'] = JSON.parse(data);
    const res = await fetch(`${base}/api/v1/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    console.log(res.status, await res.text());
    return;
  }

  if (cmd === 'deliveries') {
    const { store } = openDb();
    if (positional[1] === 'retry') {
      const id = positional[2];
      if (!id) throw new Error('用法: deliveries retry <id>');
      const n = store.retryDelivery(id);
      console.log(n > 0 ? `已排入重试：${id}` : `该投递当前不可重试（可能已在发送或已送达）：${id}`);
      store.close();
      process.exitCode = n > 0 ? 0 : 1;
      return;
    }
    const limit = Number(flagStr(flags, 'limit') ?? 20);
    const status = flagStr(flags, 'status');
    print(
      store
        .listDeliveries(Number.isFinite(limit) ? limit : 20)
        .filter((d) => !status || d.status === status)
        .map((d) => ({
          id: d.id,
          channel: store.getChannelById(d.channelId)?.name ?? d.channelId,
          status: d.status,
          attempts: d.attempts,
          error: d.lastError,
        })),
    );
    store.close();
    return;
  }

  if (cmd === 'dev-seed') {
    const { store } = openDb();
    const { source, token } = store.createSource({ name: 'cli' });
    store.upsertChannel({ name: 'local', kind: 'local', config: {} });
    const webhook = flagStr(flags, 'webhook');
    if (webhook) store.upsertChannel({ name: 'hook', kind: 'webhook', config: { url: webhook } });
    store.upsertRule({
      name: '全部事件 → 本地',
      priority: 100,
      when: {},
      actions: [{ channel: 'local' }, ...(webhook ? [{ channel: 'hook' }] : [])],
    });
    print({ source: source.name, token });
    console.log('\n验证：');
    console.log(
      `  nh emit --token ${token} --type demo.hello --text "你好 notify-hub"`,
    );    store.close();
    return;
  }

  console.error(`未知命令: ${argv.join(' ')}\n`);
  console.log(HELP);
  process.exit(1);
}

main().catch((err) => {
  console.error('错误:', (err as Error).message);
  process.exit(1);
});
