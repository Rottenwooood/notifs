import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { ProducerManifest } from '@notify-hub/contracts';
import { syncProducers } from '@notify-hub/producers';
import type { Store } from '@notify-hub/store';
import { staticCheck, type CheckReport } from './check.ts';
import type { LlmProvider } from './llm.ts';
import { buildSystemPrompt, parseGeneration } from './parse.ts';
import { trialRun, type TrialOptions, type TrialResult } from './trial.ts';

const META = '.meta.json';

export interface DraftMeta {
  slug: string;
  requirement: string;
  createdAt: string;
  status: 'draft' | 'approved' | 'rejected';
  provider: string;
  files: string[];
  updatedAt: string;
  approvedAt?: string;
  rejectedReason?: string;
}

export interface AuthoringOptions {
  draftsDir: string;
  producersDir: string;
  dataDir: string;
  /** 仅生成需要；查看/检查/试运行/审批不需要 */
  provider?: LlmProvider;
  /** producer-protocol 规范全文（生成的唯一契约） */
  protocolDoc: string;
  now?: () => Date;
}

export type GenerateResult =
  | { status: 'clarify'; questions: string[] }
  | { status: 'draft'; meta: DraftMeta };

function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, base));
    else out.push(relative(base, full));
  }
  return out;
}

/** Agent 生成监控程序（§5.4）：需求 → 草稿 → 检查 → 试运行 → 审核 → 上线。 */
export class Authoring {
  private readonly now: () => Date;

  constructor(
    private readonly store: Store,
    private readonly opts: AuthoringOptions,
  ) {
    this.now = opts.now ?? ((): Date => new Date());
  }

  private draftDir(slug: string): string {
    return join(this.opts.draftsDir, slug);
  }

  private writeMeta(meta: DraftMeta): void {
    mkdirSync(this.draftDir(meta.slug), { recursive: true });
    writeFileSync(join(this.draftDir(meta.slug), META), JSON.stringify(meta, null, 2));
  }

  private readMeta(slug: string): DraftMeta | undefined {
    try {
      return JSON.parse(readFileSync(join(this.draftDir(slug), META), 'utf8')) as DraftMeta;
    } catch {
      return undefined;
    }
  }

  /** 读草稿里的文件（扁平：相对路径 → 内容），忽略内部元数据。 */
  readFiles(slug: string): Record<string, string> {
    const dir = this.draftDir(slug);
    const files: Record<string, string> = {};
    for (const rel of listFiles(dir)) files[rel] = readFileSync(join(dir, rel), 'utf8');
    return files;
  }

  listDrafts(): DraftMeta[] {
    if (!existsSync(this.opts.draftsDir)) return [];
    return readdirSync(this.opts.draftsDir)
      .filter((d) => statSync(join(this.opts.draftsDir, d)).isDirectory())
      .map((d) => this.readMeta(d))
      .filter((m): m is DraftMeta => !!m)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getDraft(slug: string): DraftMeta | undefined {
    return this.readMeta(slug);
  }

  /** 需求 → 生成（可能先返回澄清问题）。 */
  async generate(requirement: string): Promise<GenerateResult> {
    const provider = this.opts.provider;
    if (!provider) {
      throw new Error('未配置 LLM：请设置 NOTIFY_LLM_MODEL（可配 NOTIFY_LLM_BASE_URL / NOTIFY_LLM_API_KEY）');
    }
    const raw = await provider.complete([
      { role: 'system', content: buildSystemPrompt(this.opts.protocolDoc) },
      { role: 'user', content: requirement },
    ]);
    const parsed = parseGeneration(raw);
    if (parsed.kind === 'clarify') return { status: 'clarify', questions: parsed.questions };

    let slug = '';
    try {
      slug = String((JSON.parse(parsed.files['producer.json'] ?? '{}') as { slug?: unknown }).slug ?? '');
    } catch {
      /* 交给静态检查报错 */
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) slug = `draft-${this.now().getTime()}`;

    const dir = this.draftDir(slug);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const [rel, content] of Object.entries(parsed.files)) {
      const full = join(dir, rel);
      if (!full.startsWith(dir)) continue; // 防目录穿越
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }

    const t = this.now().toISOString();
    const meta: DraftMeta = {
      slug,
      requirement,
      createdAt: t,
      updatedAt: t,
      status: 'draft',
      provider: provider.name,
      files: Object.keys(parsed.files),
    };
    this.writeMeta(meta);
    return { status: 'draft', meta };
  }

  /** 静态检查（§5.4.1）：清单合法性、危险操作、凭据是否就绪。 */
  check(slug: string, env: NodeJS.ProcessEnv = process.env): CheckReport {
    const files = this.readFiles(slug);
    const existing = new Set(this.store.listSources().map((s) => s.name));
    return staticCheck({ files, existingSlugs: existing, env });
  }

  /** 试运行：在受限接收端跑一小段时间，收集"将会上报的事件"。 */
  async trial(slug: string, opts: TrialOptions = {}): Promise<TrialResult> {
    const files = this.readFiles(slug);
    const manifest = JSON.parse(files['producer.json'] ?? '{}') as ProducerManifest;
    if (!manifest.command?.length) throw new Error('该草稿没有可执行命令（poller 无需试运行）');
    return trialRun(this.draftDir(slug), manifest, opts);
  }

  /** 人工审核通过 → 落盘到监控程序区 → 登记 → 启用（§5.4.1 硬门槛）。 */
  approve(slug: string): DraftMeta {
    const meta = this.readMeta(slug);
    if (!meta) throw new Error(`没有草稿：${slug}`);
    const check = this.check(slug);
    if (!check.ok) {
      throw new Error(`静态检查未通过，拒绝上线：${check.issues.filter((i) => i.level === 'error').map((i) => i.message).join('；')}`);
    }
    const from = this.draftDir(slug);
    const to = join(this.opts.producersDir, slug);
    rmSync(to, { recursive: true, force: true });
    mkdirSync(to, { recursive: true });
    for (const rel of listFiles(from)) {
      mkdirSync(dirname(join(to, rel)), { recursive: true });
      cpSync(join(from, rel), join(to, rel));
    }

    const sync = syncProducers(this.store, {
      producersDir: this.opts.producersDir,
      dataDir: this.opts.dataDir,
    });
    const producer = this.store.getProducerBySlug(slug);
    if (producer) this.store.setProducerEnabled(producer.id, true);

    meta.status = 'approved';
    meta.approvedAt = this.now().toISOString();
    meta.updatedAt = meta.approvedAt;
    this.writeMeta(meta);
    void sync;
    return meta;
  }

  reject(slug: string, reason: string): DraftMeta {
    const meta = this.readMeta(slug);
    if (!meta) throw new Error(`没有草稿：${slug}`);
    meta.status = 'rejected';
    meta.rejectedReason = reason;
    meta.updatedAt = this.now().toISOString();
    this.writeMeta(meta);
    return meta;
  }
}
