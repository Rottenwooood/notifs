import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { EndpointSchema, JsonValueSchema, SubscriptionSchema } from '@notify-hub/contracts';
import { MessageClient } from '../../core/src/client.ts';

export async function startMcp(options: {baseUrl: string; token: string; socketPath?: string}): Promise<void> {
  const client = new MessageClient(options);
  const actor = await client.call<{identity:string;manager:boolean}>('authenticate');
  const server = new McpServer({name:'notifs',version:'0.2.0'}, {
    instructions: `身份 ${actor.identity}。send 发布 type/content；消息由中心推送至接收目标的适配器，无需调用接收工具。${actor.manager ? '你可以管理身份、接收目标和订阅。' : '订阅由管理身份配置。'}`,
  });
  const run = async (operation: string, input: unknown = {}) => {
    try {return {content:[{type:'text' as const,text:JSON.stringify(await client.call(operation,input))}]};}
    catch(err) {return {isError:true,content:[{type:'text' as const,text:err instanceof Error ? err.message : String(err)}]};}
  };
  server.registerTool('send', {
    description:'发布消息；to 可选且仅缩小订阅范围。',
    inputSchema:{type:z.string().min(1),content:JsonValueSchema,to:z.array(z.string()).optional()},
  }, async ({type,content,to}) => {
    try{return {content:[{type:'text' as const,text:JSON.stringify(await client.send({type,content},{to}))}]};}
    catch(err){return {isError:true,content:[{type:'text' as const,text:String(err)}]};}
  });
  server.registerTool('inspect', {description:'查询自己发送或收到的消息和投递状态。',inputSchema:{id:z.string().uuid()}}, input=>run('inspect',input));
  if(actor.manager) {
    server.registerTool('create_identity', {description:'创建发送/接收身份；manager=true 允许编辑订阅及目标。凭据只返回一次，应存私有配置。',inputSchema:{name:z.string(),manager:z.boolean().default(false)}}, input=>run('identities.create',input));
    server.registerTool('list_identities', {description:'列出身份，不返回 token。',inputSchema:{}}, ()=>run('identities.list'));
    server.registerTool('rotate_identity', {description:'轮换指定身份凭据；旧 token 立即失效。',inputSchema:{name:z.string()}}, input=>run('identities.rotate',input));
    server.registerTool('set_identity_enabled', {description:'启用或停用身份。',inputSchema:{name:z.string(),enabled:z.boolean()}}, input=>run('identities.enable',input));
    server.registerTool('set_endpoint', {description:'配置接收目标：owner 是身份名；delivery 指定适配器及地址；中心主动交付，webhook 接程序，opencode 接会话，通知适配器接人。',inputSchema:EndpointSchema.shape}, input=>run('endpoints.put',input));
    server.registerTool('list_endpoints', {description:'查看接收目标及投递方式。',inputSchema:{}}, ()=>run('endpoints.list'));
    server.registerTool('resume_endpoint', {description:'恢复保留的失败批次。',inputSchema:{endpoint:z.string()}}, input=>run('endpoints.resume',input));
    server.registerTool('set_subscription', {description:'设置谁订阅什么：endpoint 是目标名，source/type 可通配，all 筛选 content。',inputSchema:SubscriptionSchema.shape}, input=>run('subscriptions.put',input));
    server.registerTool('list_subscriptions', {description:'查看当前全部订阅。',inputSchema:{}}, ()=>run('subscriptions.list'));
    server.registerTool('remove_subscription', {description:'删除订阅，不丢弃已经排队的消息。',inputSchema:{name:z.string()}}, input=>run('subscriptions.remove',input));
  }
  server.server.onclose=()=>client.close();
  await server.connect(new StdioServerTransport());
}
