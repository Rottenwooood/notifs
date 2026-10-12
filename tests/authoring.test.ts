import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Authoring, parseGeneration, staticCheck, trialRun, type LlmProvider } from '@notify-hub/authoring';
import { testStore } from './helpers.ts';

const GENERATED = `这里是生成的说明。

### FILE: producer.json
\`\`\`json
{
  "name": "演示监控",
  "slug": "demo-gen",
  "kind": "managed",
  "command": ["node", "index.mjs"],
  "config": { "url": "http://example.com" }
}
\`\`\`

### FILE: index.mjs
\`\`\`js
console.log('hi from demo');
\`\`\`

### FILE: README.md
\`\`\`md
访问 http://example.com，变了就通知。
\`\`\`
`;

describe('解析 LLM 输出', () => {
  it('解析多文件', () => {
    const r = parseGeneration(GENERATED);
    expect(r.kind).toBe('files');
    expect(Object.keys(r.files)).toEqual(['producer.json', 'index.mjs', 'README.md']);
    expect(JSON.parse(r.files['producer.json']!)['slug']).toBe('demo-gen');
  });
  it('解析澄清问题', () => {
    const r = parseGeneration('### CLARIFY\n- 要监控哪个仓库？\n- 多久查一次？');
    expect(r.kind).toBe('clarify');
    expect(r.questions).toEqual(['要监控哪个仓库？', '多久查一次？']);
  });
  it('拒绝带目录穿越的路径', () => {
    const r = parseGeneration('### FILE: ../../etc/passwd\n```\nx\n```\n### FILE: ok.txt\n```\ny\n```');
    expect(Object.keys(r.files)).toEqual(['ok.txt']);
  });
});

describe('静态检查', () => {
  const valid = {
    'producer.json': JSON.stringify({ name: 'x', slug: 'x', kind: 'managed', command: ['node', 'index.mjs'] }),
    'index.mjs': 'console.log(1)',
  };
  it('缺 producer.json → 错误', () => {
    expect(staticCheck({ files: { 'a.js': '' }, existingSlugs: new Set(), env: {} }).ok).toBe(false);
  });
  it('合法 → 通过', () => {
    const r = staticCheck({ files: valid, existingSlugs: new Set(), env: {} });
    expect(r.ok).toBe(true);
    expect(r.manifest?.slug).toBe('x');
  });
  it('声明的凭据缺失 → 提醒', () => {
    const files = {
      'producer.json': JSON.stringify({ name: 'x', slug: 'x', kind: 'managed', command: ['node', 'i.mjs'], credentials: ['GITHUB_TOKEN'] }),
      'i.mjs': '',
    };
    const r = staticCheck({ files, existingSlugs: new Set(), env: {} });
    expect(r.credentialsMissing).toEqual(['GITHUB_TOKEN']);
    expect(r.issues.some((i) => i.level === 'warn')).toBe(true);
  });
  it('危险操作 → 提醒（不拦截）', () => {
    const files = { ...valid, 'index.mjs': 'execSync("rm -rf /")' };
    const r = staticCheck({ files, existingSlugs: new Set(), env: {} });
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.message.includes('高危'))).toBe(true);
  });
  it('同名已存在 → 提醒', () => {
    const r = staticCheck({ files: valid, existingSlugs: new Set(['x']), env: {} });
    expect(r.issues.some((i) => i.message.includes('已有同名'))).toBe(true);
  });
});

describe('试运行（拦截事件）', () => {
  it('跑一段小程序，收集它将会上报的事件', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nh-trial-'));
    const manifest = { name: 't', slug: 'trial-ok', kind: 'managed' as const, command: ['node', 'index.mjs'] };
    writeFileSync(
      join(dir, 'index.mjs'),
      `const base = process.env.NOTIFY_BASE_URL;
       await fetch(base + '/api/v1/producers/x/heartbeat', {method:'POST',headers:{'content-type':'application/json'},body:'{}'});
       await fetch(base + '/api/v1/events', {method:'POST',headers:{'content-type':'application/json'},
         body: JSON.stringify({ type:'demo.trial', text:'来自试运行' })});
       console.log('posted-ok');`,
    );
    const r = await trialRun(dir, manifest, { timeoutMs: 5000, baseEnv: {} });
    expect(r.exitCode).toBe(0);
    expect(r.events).toHaveLength(1);
    expect((r.events[0] as { type: string }).type).toBe('demo.trial');
    expect(r.heartbeatCount).toBe(1);
    expect(r.stdout).toContain('posted-ok');
  });
});

describe('生成 → 检查 → 审批上线（§5.4）', () => {
  function setup(provider: LlmProvider) {
    const root = mkdtempSync(join(tmpdir(), 'nh-auth-'));
    const store = testStore();
    const authoring = new Authoring(store, {
      draftsDir: join(root, 'drafts'),
      producersDir: join(root, 'producers'),
      dataDir: join(root, 'data'),
      provider,
      protocolDoc: '（规范占位）',
    });
    return { root, store, authoring };
  }

  const fileProvider: LlmProvider = { name: 'stub', async complete() { return GENERATED; } };
  const clarifyProvider: LlmProvider = {
    name: 'stub',
    async complete() { return '### CLARIFY\n- 要监控哪个仓库？'; },
  };

  it('需求不足时返回澄清问题', async () => {
    const { authoring } = setup(clarifyProvider);
    const r = await authoring.generate('监控一下那个东西');
    expect(r.status).toBe('clarify');
    if (r.status === 'clarify') expect(r.questions[0]).toContain('仓库');
  });

  it('生成草稿 → 检查通过 → 审批后落到监控程序区并启用', async () => {
    const { store, authoring, root } = setup(fileProvider);
    const gen = await authoring.generate('监控 example.com，变了就通知我');
    expect(gen.status).toBe('draft');
    if (gen.status !== 'draft') return;
    const slug = gen.meta.slug;
    expect(slug).toBe('demo-gen');
    expect(authoring.readFiles(slug)['index.mjs']).toContain('hi from demo');
    expect(existsSync(join(root, 'drafts', slug, '.meta.json'))).toBe(true);

    expect(authoring.check(slug).ok).toBe(true);

    const approved = authoring.approve(slug);
    expect(approved.status).toBe('approved');

    const published = join(root, 'producers', slug);
    expect(existsSync(join(published, 'producer.json'))).toBe(true);
    expect(existsSync(join(published, 'index.mjs'))).toBe(true);
    expect(existsSync(join(published, '.meta.json'))).toBe(false); // 内部元数据不外泄

    const producer = store.getProducerBySlug(slug)!;
    expect(producer.enabled).toBe(true); // 上线即启用
    expect(JSON.parse(readFileSync(join(published, 'producer.json'), 'utf8')).kind).toBe('managed');
  });

  it('静态检查不通过的草稿拒绝上线', async () => {
    const bad: LlmProvider = {
      name: 'stub',
      async complete() {
        return '### FILE: producer.json\n```json\n{ "name":"坏", "slug":"bad", "kind":"managed" }\n```\n';
      },
    };
    const { authoring } = setup(bad);
    const gen = await authoring.generate('随便');
    expect(gen.status).toBe('draft');
    if (gen.status !== 'draft') return;
    expect(() => authoring.approve(gen.meta.slug)).toThrow(/静态检查未通过/);
  });
});
