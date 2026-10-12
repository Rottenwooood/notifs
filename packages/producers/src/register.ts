import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProducerManifest } from '@notify-hub/contracts';
import type { Store } from '@notify-hub/store';
import { loadManifests, type ManifestError } from './manifest.ts';

/** 存进 DB 的 producer 配置：清单 + 磁盘目录（supervisor 用它做 cwd）。 */
export type StoredProducerConfig = ProducerManifest & { dir: string };

export interface SyncResult {
  entries: { slug: string; producerId: string; action: 'created' | 'updated'; tokenWritten: boolean }[];
  errors: ManifestError[];
}

export interface SyncOptions {
  producersDir: string;
  dataDir: string;
}

/**
 * 把磁盘上的 producer 清单同步进 DB（幂等）：
 * 每个清单目录 → 一个同名 source（slug）→ 一个 producer 行。
 * managed 程序的 token 写入其独占 `state_dir/token`（0600），DB 仍只存哈希（§5.8）。
 */
export function syncProducers(store: Store, opts: SyncOptions): SyncResult {
  const { manifests, errors } = loadManifests(opts.producersDir);
  const entries: SyncResult['entries'] = [];

  for (const { manifest, dir } of manifests) {
    const stateDir = join(opts.dataDir, 'producers', manifest.slug);
    mkdirSync(stateDir, { recursive: true });

    let source = store.getSourceByName(manifest.slug);
    let tokenWritten = false;
    if (!source) {
      const created = store.createSource({
        name: manifest.slug,
        kind: manifest.kind === 'poller' ? 'poller' : 'managed',
      });
      source = created.source;
      writeFileSync(join(stateDir, 'token'), created.token, { mode: 0o600 });
      tokenWritten = true;
    } else if (manifest.kind === 'managed' && !existsSync(join(stateDir, 'token'))) {
      errors.push({
        dir,
        error: `token 文件缺失（${join(stateDir, 'token')}）。token 只存哈希，无法恢复；请重置该 source 的 token。`,
      });
    }

    const existing = store.getProducerBySourceId(source.id);
    const producer = store.upsertProducer({
      sourceId: source.id,
      kind: manifest.kind,
      stateDir,
      config: { ...manifest, dir },
      enabled: manifest.enabled !== false,
    });
    entries.push({
      slug: manifest.slug,
      producerId: producer.id,
      action: existing ? 'updated' : 'created',
      tokenWritten,
    });
  }

  return { entries, errors };
}
