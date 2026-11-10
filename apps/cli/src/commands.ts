import { MessageClient } from '../../../packages/core/src/client.ts';
import type { MessageInput } from '@notify-hub/contracts';

export const MESSAGE_HELP = `notifs：统一订阅通信中心
  init / start / mcp [--socket <路径>]
  service install [--print] | uninstall    写 systemd 用户服务，不自动启用
  backup <path>                            在线备份数据库
  restore <path> --force                   停止服务后恢复数据库
  identity add <name> [--manager]          创建发送/接收身份；manager 可配置订阅
  identity list | rotate <name> | enable <name> | disable <name>
  endpoint put --config '<json>'          name、owner、delivery；必须指定适配器
  endpoint list | resume <name>
  subscription put --config '<json>'      name、endpoint；可选 source、type、all
  subscription list | rm <name>
  message send '<文本>' --type <t> [--to a,b] [--id <重试ID>]
    --content '<json>'                    使用结构化内容
  message inspect <message-id> | status
  --token <身份凭据> / NOTIFS_TOKEN；人默认读取 controller-token。
  --server <URL> 或 --socket <路径>；所有发送、接收与管理都用同一身份凭据。
`;
export async function runMessagingCLI(positional: string[], flags: Record<string, string | true>, config: { configDir: string; baseUrl: string }, defaultToken?: string): Promise<boolean> {
  const [cmd, action, name] = positional;
  if (!['identity', 'endpoint', 'subscription', 'message'].includes(cmd ?? '')) return false;
  const flag = (key: string) => typeof flags[key] === 'string' ? flags[key] as string : undefined;
  const token = flag('token') ?? defaultToken;
  if (!token) throw new Error('缺少身份凭据：运行 notifs init 或设置 NOTIFS_TOKEN');
  const client = new MessageClient({ token, socketPath: flag('socket'), baseUrl: flag('server') ?? config.baseUrl });
  const required = (value: string | undefined, label: string) => { if (!value) throw new Error(`缺少 ${label}`); return value; };
  let result: unknown;
  try {
    if (cmd === 'identity' && action === 'add') result = await client.call('identities.create', { name: required(name, '身份名称'), manager: flags.manager === true });
    else if (cmd === 'identity' && action === 'list') result = await client.call('identities.list');
    else if (cmd === 'identity' && action === 'rotate') result = await client.call('identities.rotate', {name: required(name, '身份名称')});
    else if (cmd === 'identity' && ['enable','disable'].includes(action ?? '')) result = await client.call('identities.enable', {name: required(name, '身份名称'), enabled: action === 'enable'});
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
    } else if (cmd === 'message' && action === 'inspect') result = await client.call('inspect', { id: required(name, '消息编号') });
    else if (cmd === 'message' && action === 'status') result = await client.call('status');
    else throw new Error('未知通信命令，运行 notifs help 查看用法');
    console.log(JSON.stringify(result, null, 2));
  } finally { client.close(); }
  return true;
}
