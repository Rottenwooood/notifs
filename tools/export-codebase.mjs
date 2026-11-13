#!/usr/bin/env node
// 把某个提交里的被跟踪文本文件按依赖顺序导出成单个纯文本文件，并自校验往返一致。
// 用法: node tools/export-codebase.mjs <输出文件> [提交]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

// 不进入产物的文件：依赖解析结果、许可证、生成稿、历史机器日志。
function excluded(path) {
  if (path === 'pnpm-lock.yaml' || path === 'LICENSE') return true;
  if (path === 'docs/design/notifs.html') return true;
  if (path === 'constraints/CONSTRAINTS.md' || path === 'constraints/constraints.html') return true;
  if (path.startsWith('docs/validation/') && path.endsWith('.json')) return true;
  return false;
}

// 阅读顺序：被依赖者在前；同一包内先出口清单 index，再按依赖方向排列。
const SEGMENTS = [
  { label: 'S1 项目定位', files: ['README.md', 'AGENTS.md', 'CHANGELOG.md'] },
  {
    label: 'S2 工作区与构建',
    files: [
      'package.json', 'pnpm-workspace.yaml', 'tsconfig.base.json', 'tsconfig.json',
      'vitest.config.ts', '.gitignore', '.github/workflows/ci.yml',
      'tools/build.mjs', 'tools/run.sh',
    ],
  },
  {
    label: 'S3 契约层 packages/contracts',
    files: ['packages/contracts/package.json', 'packages/contracts/src/index.ts'],
  },
  {
    label: 'S4 存储层 packages/store',
    files: [
      'packages/store/package.json', 'packages/store/src/schema.ts',
      'packages/store/src/index.ts',
    ],
  },
  {
    label: 'S5 核心内核 packages/core',
    files: [
      'packages/core/package.json', 'packages/core/src/index.ts',
      'packages/core/src/framing.ts', 'packages/core/src/client.ts',
      'packages/core/src/router.ts', 'packages/core/src/kernel.ts',
    ],
  },
  {
    label: 'S6 投递适配 packages/adapters',
    files: [
      'packages/adapters/package.json', 'packages/adapters/src/index.ts',
      'packages/adapters/src/delivery.ts', 'packages/adapters/src/render.ts',
      'packages/adapters/src/local.ts', 'packages/adapters/src/webhook.ts',
      'packages/adapters/src/ntfy.ts', 'packages/adapters/src/bark.ts',
      'packages/adapters/src/wecom.ts', 'packages/adapters/src/feishu.ts',
      'packages/adapters/src/feishu-app.ts', 'packages/adapters/src/feishu-inbound.ts',
      'packages/adapters/src/feishu-inbound-server.ts', 'packages/adapters/src/opencode.ts',
    ],
  },
  {
    label: 'S7 服务进程 apps/server',
    files: [
      'apps/server/package.json', 'apps/server/src/config.ts',
      'apps/server/src/credentials.ts', 'apps/server/src/adapters.ts',
      'apps/server/src/kernel-worker.ts', 'apps/server/src/kernel-bootstrap.mjs',
      'apps/server/src/kernel-host.ts', 'apps/server/src/http.ts',
      'apps/server/src/ipc.ts', 'apps/server/src/app.ts', 'apps/server/src/main.ts',
    ],
  },
  {
    label: 'S8 MCP 接口 packages/mcp',
    files: ['packages/mcp/package.json', 'packages/mcp/src/index.ts'],
  },
  {
    label: 'S9 命令行 apps/cli',
    files: [
      'apps/cli/package.json', 'apps/cli/src/commands.ts',
      'apps/cli/src/service.ts', 'apps/cli/src/main.ts',
    ],
  },
  {
    label: 'S10 入站守护 apps/feishu-inbound',
    files: [
      'apps/feishu-inbound/package.json', 'apps/feishu-inbound/src/lock.ts',
      'apps/feishu-inbound/src/main.ts',
    ],
  },
  {
    label: 'S11 测试',
    files: [
      'tests/adapters.test.ts', 'tests/adapters-integration.test.ts',
      'tests/messaging.test.ts', 'tests/messaging-transports.test.ts',
      'tests/feishu.test.ts', 'tests/feishu-app.test.ts', 'tests/feishu-inbound.test.ts',
      'tests/feishu-lock.test.ts', 'tests/opencode.test.ts', 'tests/cli-service.test.ts',
    ],
  },
  {
    label: 'S12 设计与运维文档',
    files: [
      'constraints/constraints.yaml', 'docs/boundaries.md', 'docs/configuration.md',
      'docs/mcp.md', 'docs/design/notifs.md', 'deploy/README.md', 'deploy/notifs.service',
      'integrations/agent/README.md', 'docs/release-plan.md',
    ],
  },
  {
    label: 'S13 阶段记录',
    files: [
      'stages/S6.md', 'stages/S7.md', 'stages/S8.md', 'stages/S9.md',
      'docs/validation/README.md',
      'docs/validation/stage-1.md', 'docs/validation/stage-2.md',
      'docs/validation/stage-3.md', 'docs/validation/stage-4.md',
      'docs/validation/stage-5.md', 'docs/validation/stage-6.md',
      'docs/validation/stage-7.md', 'docs/validation/stage-8.md',
    ],
  },
  {
    label: 'S14 附带工具',
    files: ['tools/export-codebase.mjs', 'tools/render-notifs-design.py'],
  },
];

const git = (...args) => execFileSync('git', args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
const root = git('rev-parse', '--show-toplevel').toString().trim();
const commit = (process.argv[3] ?? 'HEAD');
const sha = git('rev-parse', commit).toString().trim();
const target = resolve(root, process.argv[2] ?? `exports/notifs-codebase-${sha.slice(0, 7)}.txt`);

const tracked = git('ls-files', '-z').toString().split('\0').filter(Boolean);
const wanted = tracked.filter(p => !excluded(p));
const placed = SEGMENTS.flatMap(s => s.files);
const duplicate = placed.filter((p, i) => placed.indexOf(p) !== i);
const missing = wanted.filter(p => !placed.includes(p));
const stale = placed.filter(p => !wanted.includes(p));
if (duplicate.length || missing.length || stale.length) {
  console.error(JSON.stringify({ duplicate, missing, stale }, null, 2));
  throw new Error('导出顺序表与被跟踪文件不一致；先更新 SEGMENTS');
}

const body = [];
const index = [];
for (const segment of SEGMENTS) {
  body.push(`### ${segment.label}`);
  for (const path of segment.files) {
    const content = git('show', `${sha}:${path}`).toString('utf8');
    if (content.includes('\r')) throw new Error(`${path} 含 CR，已中止`);
    if (!content.endsWith('\n')) throw new Error(`${path} 末尾缺少换行，已中止`);
    const start = body.length + 1;
    body.push(path);
    for (const line of content.slice(0, -1).split('\n')) body.push(line === '' ? '  ' : `  ${line}`);
    body.push('');
    index.push({ path, start, end: body.length - 1 });
  }
}

const meta = [
  '# notifs 代码包',
  `# 仓库: ${root}`,
  `# 提交: ${sha}`,
  `# 生成时间: ${new Date().toISOString()}`,
  `# 文件数: ${placed.length}`,
  `# 正文字节: ${Buffer.byteLength(body.join('\n') + '\n')}`,
  '# 排序: 被依赖者在前；同一包内先 index 出口清单，再按依赖方向',
  '# 排除: pnpm-lock.yaml、LICENSE、docs/design/notifs.html（生成稿）、constraints/CONSTRAINTS.md 与 constraints.html（生成稿）、docs/validation/*.json（6 个机器日志）、未跟踪的 dist/ 与 *.tgz',
  '# 读法: 路径行不缩进；代码行以两个空格开头，空行写成两个空格；### 开头是分段标记',
  '## 文件索引',
];
const offset = meta.length + index.length + 1; // 索引行之后的 `## 正文` 行
const indexLines = index.map((e, i) =>
  `${String(i + 1).padStart(4, '0')}  行 ${offset + e.start}-${offset + e.end}  ${e.path}`);
const text = [...meta, ...indexLines, '## 正文', ...body].join('\n') + '\n';

// 自校验：逆解析产物，逐文件与提交内容比对。
const textLines = text.split('\n');
const bodyAt = textLines.indexOf('## 正文');
if (bodyAt < 0) throw new Error('产物缺少正文标记');
const rebuilt = new Map();
let current = null;
for (const line of textLines.slice(bodyAt + 1)) {
  if (line === '') continue;
  if (!line.startsWith(' ') && !line.startsWith('#')) {
    current = [];
    rebuilt.set(line, current);
    continue;
  }
  if (line.startsWith('  ')) {
    if (!current) throw new Error(`孤立代码行: ${line.slice(0, 40)}`);
    current.push(line.slice(2));
  }
}
const mismatches = [];
for (const path of placed) {
  const expected = createHash('sha256').update(git('show', `${sha}:${path}`)).digest('hex');
  const actual = createHash('sha256').update(Buffer.from(rebuilt.get(path).join('\n') + '\n')).digest('hex');
  if (expected !== actual) mismatches.push(path);
}
if (rebuilt.size !== placed.length) throw new Error(`还原文件数 ${rebuilt.size} ≠ ${placed.length}`);
if (mismatches.length) throw new Error(`往返不一致: ${mismatches.join(', ')}`);

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, text);

console.log(JSON.stringify({
  output: isAbsolute(target) ? target : resolve(root, target),
  commit: sha,
  files: placed.length,
  bodyLines: body.length,
  bytes: Buffer.byteLength(text),
  roundTrip: 'ok',
}, null, 2));
