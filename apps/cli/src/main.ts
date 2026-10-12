#!/usr/bin/env node
import { openStore } from '@notify-hub/store';
import { loadConfig } from '../../server/src/config.ts';

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

const HELP = `notify-hub CLI

  migrate
  source add <name> [--dedup-ttl <sec>]        新建源，打印 token（只显示一次）
  source list
  channel add <name> --kind <kind> [--config <json>]
  channel list
  rule add --name <name> --when <json> --actions <json> [--priority <n>] [--exclusive]
  rule list
  emit --server <base> --token <t> --type <type> --text <text> [--title <t>] [--url <u>] [--dedup-key <k>] [--data <json>]
  deliveries [--limit <n>]
  dev-seed [--webhook <url>]                    建演示用的 source + local/webhook 通道 + 默认规则
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { positional, flags } = parseArgs(argv);
  const [cmd, sub] = positional;

  if (!cmd || cmd === 'help' || flags['help']) {
    console.log(HELP);
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
    const limit = Number(flagStr(flags, 'limit') ?? 20);
    print(
      store.listDeliveries(limit).map((d) => ({
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
      `  pnpm cli emit --token ${token} --type demo.hello --text "你好 notify-hub"`,
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
