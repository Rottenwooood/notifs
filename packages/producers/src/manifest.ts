import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ProducerManifestSchema, type ProducerManifest } from '@notify-hub/contracts';

export interface LoadedManifest {
  manifest: ProducerManifest;
  dir: string;
  path: string;
}

export interface ManifestError {
  dir: string;
  error: string;
}

/**
 * 扫描 `producers/*​/producer.json`。**文件系统是"存在哪些程序"的期望状态**，
 * DB 只保存运行状态与启用开关（见 §5.3 / §5.4）。
 */
export function loadManifests(producersDir: string): {
  manifests: LoadedManifest[];
  errors: ManifestError[];
} {
  const manifests: LoadedManifest[] = [];
  const errors: ManifestError[] = [];
  let entries: string[];
  try {
    entries = readdirSync(producersDir);
  } catch {
    return { manifests, errors };
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const dir = join(producersDir, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const path = join(dir, 'producer.json');
    try {
      statSync(path);
    } catch {
      continue; // 没有 producer.json 的目录直接跳过
    }
    try {
      const manifest = ProducerManifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
      manifests.push({ manifest, dir, path });
    } catch (err) {
      errors.push({ dir, error: (err as Error).message });
    }
  }
  return { manifests, errors };
}
