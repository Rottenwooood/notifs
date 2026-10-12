// GitHub PR 评论监控（notify-hub managed 监控程序样板）
//
// 只做两件事：发现新评论 → 按 producer-protocol 上报；以及周期心跳。
// 断点/快照存在 NOTIFY_STATE_DIR，中心不替它保存。
//
// 配置来自 NOTIFY_CONFIG：{ repo: "owner/name", pr: 123, apiBase?, intervalSeconds? }
// 凭据来自环境变量 GITHUB_TOKEN（manifest.credentials 声明后由中心注入）。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.NOTIFY_BASE_URL;
const TOKEN = process.env.NOTIFY_TOKEN;
const PRODUCER_ID = process.env.NOTIFY_PRODUCER_ID;
const STATE_DIR = process.env.NOTIFY_STATE_DIR;
const CONFIG = JSON.parse(process.env.NOTIFY_CONFIG || '{}');

const log = (...args) => console.log(new Date().toISOString(), ...args);

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

const heartbeat = (status, detail) =>
  post(`/api/v1/producers/${PRODUCER_ID}/heartbeat`, { status, detail }).catch(() => {});

function readState() {
  try {
    return JSON.parse(readFileSync(join(STATE_DIR, 'cursor.json'), 'utf8'));
  } catch {
    return { lastCommentId: 0 };
  }
}

function writeState(state) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(join(STATE_DIR, 'cursor.json'), JSON.stringify(state));
}

async function pollOnce(state) {
  const url = `${CONFIG.apiBase || 'https://api.github.com'}/repos/${CONFIG.repo}/issues/${CONFIG.pr}/comments?per_page=100`;
  const headers = { accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`拉取评论失败: HTTP ${res.status}`);
  const comments = await res.json();

  let maxId = state.lastCommentId;
  let emitted = 0;
  for (const c of comments) {
    if (typeof c.id !== 'number' || c.id <= state.lastCommentId) continue;
    maxId = Math.max(maxId, c.id);
    await post('/api/v1/events', {
      type: 'github.pr.reply',
      title: `${CONFIG.repo} PR #${CONFIG.pr} 有新回复`,
      text: `${c.user?.login ?? '某人'}: ${c.body ?? ''}`,
      url: c.html_url,
      dedup_key: `pr:${CONFIG.pr}:comment:${c.id}`,
      at: c.created_at,
      data: { repo: CONFIG.repo, pr: CONFIG.pr, author: c.user?.login, comment_id: c.id },
    });
    emitted++;
  }
  if (maxId !== state.lastCommentId) {
    state.lastCommentId = maxId;
    writeState(state);
  }
  return emitted;
}

async function main() {
  if (!CONFIG.repo || !CONFIG.pr) {
    log('缺少配置：NOTIFY_CONFIG 需要 { repo, pr }。上报 error 心跳后退出。');
    await heartbeat('error', '缺少配置 repo/pr');
    process.exit(0); // exit 0：配置问题不该触发无限重启
  }

  const intervalMs = (CONFIG.intervalSeconds ?? 60) * 1000;
  const hb = setInterval(() => heartbeat('ok').catch(() => {}), 30_000);
  await heartbeat('ok', '启动');

  const state = readState();
  log(`监控 ${CONFIG.repo} PR #${CONFIG.pr}，cursor=${state.lastCommentId}`);

  for (;;) {
    try {
      const n = await pollOnce(state);
      if (n > 0) log(`上报 ${n} 条新评论`);
    } catch (err) {
      log('轮询异常:', err.message);
      await heartbeat('degraded', err.message);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  clearInterval(hb);
}

main().catch(async (err) => {
  await heartbeat('error', String(err));
  process.exit(1); // 非 0：让中心按退避重启
});
