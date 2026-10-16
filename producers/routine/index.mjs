// 作息提醒（notify-hub managed 监控程序）
//
// 到点就 POST 一条 routine.reminder。中心没有内置调度器（这是刻意的），
// 所以"几点该提醒"这件事在这里：自己看表、自己 sleep。
//
// 配置（producer.json 的 config）：
//   timezone      时间基准，默认 Asia/Shanghai
//   graceMinutes  迟到宽限：到点后 N 分钟内仍会补发（默认 30）；超过就当今天错过了
//   pollSeconds   多久看一眼表（默认 20）
//   items[]       { id, at:"HH:MM", title, text?, days?[0-6, 0=周日], severity? }
//                 days 不写 = 每天
//
// 要点：
//   - 每条每天只响一次：dedup_key = routine:<id>:<日期>，且发出去之后才记进状态
//   - 电脑关着 / 进程没在跑时错过的点：超过宽限窗口就不再补发（免得开一次机弹一堆）
//   - 状态写在 NOTIFY_STATE_DIR/state.json，重启续得上

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.NOTIFY_BASE_URL;
const TOKEN = process.env.NOTIFY_TOKEN;
const PRODUCER_ID = process.env.NOTIFY_PRODUCER_ID;
const STATE_DIR = process.env.NOTIFY_STATE_DIR;
const CFG = JSON.parse(process.env.NOTIFY_CONFIG || '{}');

const TZ = CFG.timezone || 'Asia/Shanghai';
const GRACE_MIN = CFG.graceMinutes ?? 30;
const POLL_MS = (CFG.pollSeconds ?? 20) * 1000;
const ITEMS = Array.isArray(CFG.items) ? CFG.items : [];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const log = (...a) => console.log(new Date().toISOString(), ...a);

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

// ---------- 状态 ----------

const STATE_FILE = join(STATE_DIR, 'state.json');

function readState() {
  try {
    const s = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    return { fired: s.fired ?? {} };
  } catch {
    return { fired: {} };
  }
}

function writeState(state) {
  // 只留最近两周的记录，别让状态文件无限长
  const keep = Object.entries(state.fired)
    .sort((a, b) => String(b[1]).localeCompare(String(a[1])))
    .slice(0, ITEMS.length * 3 + 14);
  state.fired = Object.fromEntries(keep);
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ---------- 时间（在指定时区里算，别信进程的本地时区）----------

function nowParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const o = Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    date: `${o.year}-${o.month}-${o.day}`,
    time: `${o.hour}:${o.minute}`,
    weekday: WEEKDAYS.indexOf(o.weekday),
  };
}

const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** 现在这一分钟，有哪些该响。 */
function dueNow(state, d = new Date()) {
  const { date, time, weekday } = nowParts(d);
  const nowMin = toMin(time);
  const due = [];
  for (const it of ITEMS) {
    if (!it?.id || !it.at) continue;
    if (state.fired[it.id] === date) continue; // 今天已经响过
    if (Array.isArray(it.days) && !it.days.includes(weekday)) continue;
    const at = toMin(it.at);
    if (nowMin >= at && nowMin < at + GRACE_MIN) due.push({ it, date });
  }
  return due;
}

async function pollOnce(state) {
  let fired = 0;
  for (const { it, date } of dueNow(state)) {
    await post('/api/v1/events', {
      type: 'routine.reminder',
      title: it.title ?? it.id,
      text: it.text ?? it.title ?? it.id,
      severity: it.severity ?? 'info',
      dedup_key: `routine:${it.id}:${date}`,
      data: { routine: it.id, at: it.at, date },
    });
    state.fired[it.id] = date; // 发成功才记账；失败就留着，下一轮（宽限期内）重试
    writeState(state);
    log(`提醒：${it.id} (${it.at})`);
    fired++;
  }
  return fired;
}

async function main() {
  if (ITEMS.length === 0) {
    log('config.items 是空的，没东西可提醒');
    await heartbeat('error', 'config.items 为空');
    process.exit(0);
  }

  const hb = setInterval(() => heartbeat('ok'), 30_000);
  hb.unref?.();
  await heartbeat('ok', '启动');

  const state = readState();
  const { date, time } = nowParts();
  log(`${TZ} ${date} ${time}，共 ${ITEMS.length} 条提醒：${ITEMS.map((i) => `${i.at} ${i.id}`).join(' / ')}`);

  for (;;) {
    try {
      const n = await pollOnce(state);
      if (n > 0) log(`上报 ${n} 条`);
    } catch (err) {
      log('异常：', err.message);
      await heartbeat('degraded', err.message); // 异常别静默
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch(async (err) => {
  await heartbeat('error', String(err));
  process.exit(1);
});
