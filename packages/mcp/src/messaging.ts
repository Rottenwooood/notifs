import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { JsonValueSchema } from '@notify-hub/contracts';
import { MessageClient } from '../../core/src/messaging/client.ts';

export async function startMessagingMcp(options: { baseUrl: string; token: string; socketPath?: string }): Promise<void> {
  const client = new MessageClient(options);
  const server = new McpServer({ name: 'notifs', version: '0.2.0' }, {
    instructions: 'notifs 是通过订阅分发消息的通信中心。send 发布消息；receive 领取完整批次，只有已可靠接管后才 ack。订阅由人或 Last Order 管理。',
  });
  const result = async (fn: () => Promise<unknown>) => {
    try { return { content: [{ type: 'text' as const, text: JSON.stringify(await fn()) }] }; }
    catch (err) { return { isError: true, content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }] }; }
  };
  server.registerTool('send', {
    description: '发布类型和完整内容；可选目标只能缩小订阅分发范围。',
    inputSchema: { type: z.string().min(1), content: JsonValueSchema, to: z.array(z.string()).optional() },
  }, ({ type, content, to }) => result(() => client.send({ type, content }, { to })));
  server.registerTool('receive', {
    description: '领取自己接收目标的完整消息批次；不会自动确认，也不会自动启动其他 agent。',
    inputSchema: { endpoint: z.string().min(1), wait_ms: z.number().int().min(0).max(30_000).optional() },
  }, ({ endpoint, wait_ms }) => result(() => client.receive(endpoint, wait_ms)));
  server.registerTool('ack', {
    description: '确认已经可靠接管整个批次，不代表任务已经完成。',
    inputSchema: { id: z.string().uuid(), lease: z.string().uuid() },
  }, input => result(() => client.call('ack', input)));
  server.registerTool('inspect', {
    description: '查看自己发送或收到的消息及投递状态。',
    inputSchema: { id: z.string().uuid() },
  }, input => result(() => client.call('inspect', input)));
  server.server.onclose = () => client.close();
  await server.connect(new StdioServerTransport());
}
