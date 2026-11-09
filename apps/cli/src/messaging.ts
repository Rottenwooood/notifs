import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MessageClient } from '../../../packages/core/src/messaging/client.ts';
import type { MessageInput } from '@notify-hub/contracts';

export const MESSAGE_HELP = `
  团队通信（v2，默认 HTTP；--socket <路径> 使用本地 IPC）
    identity add <name>                          创建身份并打印凭据（管理操作）
    endpoint put --config '<json>'               接收目标配置：name、owner；可选 channel 和批量参数
    endpoint list | resume <name>                查看目标 / 恢复保留批次（管理操作）
    subscription put --config '<json>'           配置订阅：name、endpoint；可选 source、type、all
    subscription list | rm <name>                管理订阅
    message send "<内容>" --type <t> [--to a,b] [--id <重试ID>]
      --content '<json>'                         发送结构化内容
    message receive <endpoint> [--wait <0-30秒>]  领取完整批次（不自动确认）
    message ack <batch-id> --lease <lease>        确认已接管批次
    message inspect <message-id> | status        查询消息 / 管理状态
  普通操作用 NOTIFS_TOKEN；管理操作用 NOTIFS_ADMIN_TOKEN 或配置目录的 admin-token。
`;
export async function runMessagingCLI(positional: string[], flags: Record<string, string | true>, config: { configDir: string; baseUrl: string }, defaultToken?: string): Promise<boolean> {
  const [cmd, action, name] = positional;
  if (!['identity', 'endpoint', 'subscription', 'message'].includes(cmd ?? '')) return false;
  const flag = (key: string) => typeof flags[key] === 'string' ? flags[key] as string : undefined;
  const manager = cmd !== 'message' || action === 'status';
  let token = flag('token') ?? (manager ? process.env.NOTIFS_ADMIN_TOKEN : defaultToken);
  if (!token && manager) {
    try { token = readFileSync(join(config.configDir, 'admin-token'), 'utf8').trim(); } catch { /* error below */ }
  }
  if (!token) throw new Error(manager ? '缺少管理凭据，请先启动中心或运行 notifs init' : '缺少身份凭据；请设置 NOTIFS_TOKEN 或 --token');
  const client = new MessageClient({ token, socketPath: flag('socket'), baseUrl: flag('server') ?? config.baseUrl });
  const required = (value: string | undefined, label: string) => { if (!value) throw new Error(`缺少 ${label}`); return value; };
  let result: unknown;
  try {
    if (cmd === 'identity' && action === 'add') result = await client.call('participants.create', { name: required(name, '身份名称') });
    else if (cmd === 'endpoint' && action === 'put') result = await client.call('endpoints.put', JSON.parse(required(flag('config'), '--config')));
    else if (cmd === 'endpoint' && action === 'list') result = await client.call('endpoints.list');
    else if (cmd === 'endpoint' && action === 'resume') result = await client.call('endpoints.resume', { endpoint: required(name, '接收目标') });
    else if (cmd === 'subscription' && action === 'put') result = await client.call('subscriptions.put', JSON.parse(required(flag('config'), '--config')));
    else if (cmd === 'subscription' && action === 'list') result = await client.call('subscriptions.list');
    else if (cmd === 'subscription' && action === 'rm') result = await client.call('subscriptions.remove', { name: required(name, '订阅名称') });
    else if (cmd === 'message' && action === 'send') {
      const content = flag('content');
      const message: MessageInput = { type: required(flag('type'), '--type'), content: content === undefined ? required(positional.slice(2).join(' '), '内容') : JSON.parse(content) };
      result = await client.send(message, { id: flag('id'), to: flag('to')?.split(',').map(x => x.trim()) });
    } else if (cmd === 'message' && action === 'receive') result = await client.receive(required(name, '接收目标'), Number(flag('wait') ?? 0) * 1000);
    else if (cmd === 'message' && action === 'ack') result = await client.call('ack', { id: required(name, '批次编号'), lease: required(flag('lease'), '--lease') });
    else if (cmd === 'message' && action === 'inspect') result = await client.call('inspect', { id: required(name, '消息编号') });
    else if (cmd === 'message' && action === 'status') result = await client.call('status');
    else throw new Error('未知通信命令，运行 notifs help 查看用法');
    console.log(JSON.stringify(result, null, 2));
  } finally { client.close(); }
  return true;
}
