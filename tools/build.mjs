#!/usr/bin/env node
// 把 CLI 和 server 各打成一个 ESM 入口（共享 chunk），只把原生模块留在外面。
import { build } from 'esbuild';
import { chmodSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });

await build({
  entryPoints: {
    cli: 'apps/cli/src/main.ts',
    server: 'apps/server/src/main.ts',
  },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  outExtension: { '.js': '.mjs' },
  external: ['better-sqlite3'],
  // 打包进来的 CJS 依赖会调 require()，ESM 输出里得给它一个真的
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
});

chmodSync('dist/cli.mjs', 0o755);
console.log('\n-> dist/cli.mjs, dist/server.mjs');
