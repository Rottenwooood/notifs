import { execFile } from 'node:child_process';
import type { OutboundAdapter, AdapterMessage, SendResult } from '@notify-hub/contracts';

/** 本机桌面 / 终端通知。Linux 走 notify-send，失败则退回 stdout。 */
export interface LocalConfig {
  /** 固定前缀，便于一眼看出是 notify-hub 发来的 */
  prefix?: string;
  /** 禁用 notify-send，只打印到日志 */
  logOnly?: boolean;
}

function runNotifySend(title: string, body: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    execFile('notify-send', ['--app-name=notifs', '--urgency=normal', title, body], {timeout: 10_000}, (err) => {
      if (err) resolve({ ok: false, error: err.message });
      else resolve({ ok: true });
    });
  });
}

export const localAdapter: OutboundAdapter = {
  kind: 'local',
  validateConfig() {
    return { ok: true };
  },
  async send(msg: AdapterMessage, cfg: unknown): Promise<SendResult> {
    const c = (cfg ?? {}) as LocalConfig;
    const title = c.prefix ? `${c.prefix}${msg.title}` : msg.title;
    const body = [msg.body, msg.url].filter(Boolean).join('\n');
    if (!c.logOnly) {
      const res = await runNotifySend(title, body);
      if (res.ok) return { ok: true };
      // notify-send 不可用时（如无 DISPLAY）退回 stdout
    }
    console.log(`[notifs][local] ${title} — ${body.replace(/\n/g, ' ')}`);
    return { ok: true };
  },
};
