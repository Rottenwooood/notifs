#!/usr/bin/env node
// 飞书事件 → notify-hub（managed 生产者，长连接模式）
//
// 为什么用长连接：飞书服务器无需回调我们的公网地址，程序主动连出去，
// 因此在只有内网/本机的情况下也能收事件（见 docs/channels.md）。
//
// 凭据（中心注入的同名环境变量）：
//   FEISHU_APP_ID / FEISHU_APP_SECRET
// 自定义配置（NOTIFY_CONFIG）：
//   { "events": ["im.message.receive_v1"], "ignoreAppSender": true }

import * as lark from '@larksuiteoapi/node-sdk';

/* ------------------------------- 环境 ------------------------------- */

function must(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[fatal] 缺少环境变量 ${name}`);
    process.exit(1);
  }
  return v;
}

const BASE = must('NOTIFY_BASE_URL').replace(/\/+$/, '');
const TOKEN = must('NOTIFY_TOKEN');
const PRODUCER_ID = must('NOTIFY_PRODUCER_ID');
const STATE_DIR = must('NOTIFY_STATE_DIR');

let CFG = {};
try {
  CFG = JSON.parse(process.env.NOTIFY_CONFIG || '{}');
} catch (err) {
  console.error('[fatal] NOTIFY_CONFIG 不是合法 JSON:', err.message);
  process.exit(1);
}

const APP_ID = process.env.FEISHU_APP_ID || '';
const APP_SECRET = process.env.FEISHU_APP_SECRET || '';
const EVENTS = Array.isArray(CFG.events) && CFG.events.length ? CFG.events : ['im.message.receive_v1'];
const IGNORE_APP_SENDER = CFG.ignoreAppSender !== false;
const HEARTBEAT_MS = 30_000;

/* ------------------------------ 中心接口 ------------------------------ */

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status} ${text}`.trim());
  return text ? JSON.parse(text) : {};
}

let connState = 'connecting';
let lastError = null;

async function heartbeat(status, detail) {
  try {
    await post(`/api/v1/producers/${PRODUCER_ID}/heartbeat`, {
      status,
      detail: String(detail ?? '').slice(0, 500),
    });
  } catch (err) {
    console.error('[heartbeat] 发送失败:', err.message);
  }
}

function statusFromConn() {
  if (connState === 'connected') return 'ok';
  if (connState === 'failed') return 'error';
  return 'degraded';
}

/* ------------------------------ 事件映射 ------------------------------ */

/** 从飞书消息内容里抽人可读文本（text / post / 其余尽力而为）。 */
function extractMessageText(messageType, contentRaw) {
  let content;
  try {
    content = JSON.parse(contentRaw || '{}');
  } catch {
    return String(contentRaw ?? '');
  }
  if (messageType === 'text') return content.text ?? '';
  if (messageType === 'post') {
    const lines = [];
    const blocks = content.content ?? content.zh_cn?.content ?? [];
    if (typeof content.title === 'string' && content.title) lines.push(content.title);
    for (const line of blocks) {
      if (!Array.isArray(line)) continue;
      lines.push(line.map((n) => n?.text ?? (n?.tag === 'a' ? n.href : '')).join(''));
    }
    return lines.filter(Boolean).join('\n');
  }
  if (messageType === 'image') return '[图片]';
  if (messageType === 'file') return `[文件] ${content.file_name ?? ''}`.trim();
  if (messageType === 'audio') return '[语音]';
  if (messageType === 'media') return '[视频]';
  if (messageType === 'sticker') return '[表情]';
  return `[${messageType ?? '未知类型'}]`;
}

/** 飞书事件 → notify-hub 信封。 */
function toEnvelope(eventType, data) {
  const eventId = data.event_id ?? `${eventType}:${data.create_time ?? Date.now()}`;
  const when = data.create_time ? new Date(Number(data.create_time)).toISOString() : undefined;

  if (eventType === 'im.message.receive_v1') {
    const message = data.message ?? {};
    const sender = data.sender ?? {};
    const mentions = Array.isArray(message.mentions) ? message.mentions : [];
    let text = extractMessageText(message.message_type, message.content);
    // 群聊里 @机器人 会在正文留下 @_user_1 这类占位符：按 key 去掉
    for (const m of mentions) {
      if (m?.key) text = text.split(m.key).join('');
    }
    text = text.replace(/\s+/g, ' ').trim();
    const isGroup = message.chat_type === 'group';
    return {
      type: `feishu.${eventType}`,
      title: `飞书${isGroup ? '群聊' : '私聊'}消息`,
      text: text || '[空消息]',
      ...(when ? { at: when } : {}),
      dedup_key: `feishu:${eventType}:${eventId}`,
      data: {
        chat_id: message.chat_id ?? null,
        chat_type: message.chat_type ?? null,
        message_id: message.message_id ?? null,
        // 引用回复时：这是被引用那条消息的 id = 出站消息的 provider_id，
        // 中心靠它把"回复"接到对应的 ask 上（v0.2 的等回复功能）
        reply_to: message.parent_id ?? message.root_id ?? null,
        message_type: message.message_type ?? null,
        sender_type: sender.sender_type ?? null,
        sender_id: sender.sender_id ?? null,
        mentions: mentions.map((m) => m?.name).filter(Boolean),
      },
    };
  }

  // 通用兜底：把事件原样塞进 data，正文用一句话概括
  return {
    type: `feishu.${eventType}`,
    title: `飞书事件：${eventType}`,
    text: JSON.stringify(data).slice(0, 2000),
    ...(when ? { at: when } : {}),
    dedup_key: `feishu:${eventType}:${eventId}`,
    data: { event_type: eventType },
  };
}

/* ------------------------------- 主流程 ------------------------------- */

async function forward(eventType, data) {
  if (IGNORE_APP_SENDER && eventType === 'im.message.receive_v1' && data.sender?.sender_type === 'app') {
    console.log('[skip] 机器人自己发的消息');
    return;
  }
  const envelope = toEnvelope(eventType, data);
  await post('/api/v1/events', envelope);
  console.log(`[event] ${eventType} → ${envelope.dedup_key}`);
}

async function main() {
  if (!APP_ID || !APP_SECRET) {
    console.error('[fatal] 缺少凭据：需要 FEISHU_APP_ID / FEISHU_APP_SECRET');
    await heartbeat('error', '缺少 FEISHU_APP_ID / FEISHU_APP_SECRET（请在「设置 → 凭据」里保存后重启本程序）');
    process.exit(0); // 配置问题不该触发无限重启
  }

  console.log(`[boot] 飞书长连接 appId=${APP_ID} 订阅=${EVENTS.join(',')} 状态目录=${STATE_DIR}`);

  const dispatcher = new lark.EventDispatcher({});
  const handlers = {};
  for (const type of EVENTS) {
    handlers[type] = async (data) => {
      try {
        await forward(type, data);
      } catch (err) {
        console.error(`[event] ${type} 上报失败:`, err.message);
        await heartbeat('degraded', `事件上报失败: ${err.message}`);
      }
    };
  }
  dispatcher.register(handlers);

  const wsClient = new lark.WSClient({
    appId: APP_ID,
    appSecret: APP_SECRET,
    loggerLevel: lark.LoggerLevel.warn,
    autoReconnect: true,
    onReady: () => {
      connState = 'connected';
      lastError = null;
      console.log('[ws] 连接就绪');
      void heartbeat('ok', '长连接就绪');
    },
    onReconnecting: () => {
      connState = 'reconnecting';
      console.log('[ws] 重连中…');
    },
    onReconnected: () => {
      connState = 'connected';
      console.log('[ws] 已重连');
      void heartbeat('ok', '长连接已重连');
    },
    onError: (err) => {
      connState = 'failed';
      lastError = err?.message ?? String(err);
      console.error('[ws] 错误:', lastError);
      void heartbeat('error', lastError);
    },
  });

  await wsClient.start({ eventDispatcher: dispatcher });

  const timer = setInterval(() => {
    const st = wsClient.getConnectionStatus?.();
    if (st?.state) connState = st.state;
    void heartbeat(statusFromConn(), lastError ?? `连接状态: ${connState}`);
  }, HEARTBEAT_MS);
  timer.unref?.();

  const shutdown = async (code) => {
    console.log('[shutdown] 关闭长连接');
    try {
      wsClient.close({ force: true });
    } catch {
      /* 忽略 */
    }
    process.exit(code);
  };
  process.on('SIGTERM', () => void shutdown(0));
  process.on('SIGINT', () => void shutdown(0));
}

main().catch(async (err) => {
  console.error('[fatal]', err);
  await heartbeat('error', `启动失败: ${err.message}`);
  process.exit(1); // 非 0 → 中心按退避重启
});
