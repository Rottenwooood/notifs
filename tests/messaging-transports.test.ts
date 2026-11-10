import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { KernelHost } from '../apps/server/src/kernel-host.ts';
import { listenMessagingIPC } from '../apps/server/src/ipc.ts';
import { startAdapters } from '../apps/server/src/adapters.ts';
import { FrameDecoder, encodeFrame } from '../packages/core/src/framing.ts';
import { MessageClient } from '../packages/core/src/client.ts';
import { buildServer } from '../apps/server/src/app.ts';
import type { MessageBatch } from '@notify-hub/contracts';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'notifs-wire-')); cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const worker = new KernelHost({ dbPath: join(dir,'db.sqlite'), adminToken: 'admin', limits: { lease_ms: 200 } }); cleanup.push(() => worker.close());
  const participant = await worker.call<{ token: string }>('identities.create', 'admin', { name: 'agent' });
  const app = buildServer({ messaging: worker });
  await app.listen({ host: '127.0.0.1', port: 0 }); cleanup.push(() => app.close());
  const baseUrl = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  const socketPath = join(dir, 'hub.sock');
  const ipc = await listenMessagingIPC(socketPath, worker); cleanup.push(() => ipc.close());
  const client = (socket: boolean, token = participant.token) => {
    const c = new MessageClient({ token, ...(socket ? { socketPath } : { baseUrl }) });
    cleanup.push(() => c.close()); return c;
  };
  await worker.call('endpoints.put','admin',{name:'agent',owner:'agent',delivery:{kind:'webhook',config:{url:'http://127.0.0.1:9000'}}});
  await worker.call('subscriptions.put','admin',{name:'all',endpoint:'agent'});
  return {worker,participant,app,baseUrl,client,socketPath};
}

describe('Worker / HTTP / IPC', () => {
  for (const ipc of [false,true]) {
    it(`${ipc ? 'IPC' : 'HTTP'} 发布幂等，管理边界一致，内部投递不向客户端开放`,async()=>{
      const f=await fixture(), c=f.client(ipc);
      const first=await c.send({type:'hello',content:{full:['中文',null,42]}},{id:'stable',to:['agent']});
      expect(first.recipients).toEqual(['agent']);
      expect((await c.send({type:'hello',content:{full:['中文',null,42]}},{id:'stable',to:['agent']})).id).toBe(first.id);
      await expect(c.call('subscriptions.put',{name:'illegal',endpoint:'agent'})).rejects.toMatchObject({code:'forbidden'});
      await expect(f.client(ipc,'admin').call('delivery.claim',{endpoint:'agent'})).rejects.toThrow();
    });
  }
  it('订阅后中心主动调用 webhook；接收程序没有领取操作',async()=>{
    const f=await fixture();
    let resolve!:(value:unknown)=>void;
    const received=new Promise(r=>resolve=r);
    const hook=createServer(async(req,res)=>{
      let body=''; for await(const chunk of req)body+=chunk;
      resolve(JSON.parse(body));res.writeHead(204).end();
    });
    await new Promise<void>(r=>hook.listen(0,'127.0.0.1',r));
    cleanup.push(()=>new Promise<void>(r=>hook.close(()=>r())));
    await f.worker.call('endpoints.put','admin',{name:'agent',owner:'agent',delivery:{kind:'webhook',config:{url:`http://127.0.0.1:${(hook.address() as {port:number}).port}`}}});
    const adapters=startAdapters(f.worker,'admin',()=>{});cleanup.push(()=>adapters.stop());
    const sent=await f.client(false).send({type:'push',content:{raw:'完整内容'}});
    const batch=await received as MessageBatch;
    expect(batch.messages[0]).toMatchObject({id:sent.id,source:'agent',content:{raw:'完整内容'}});
  });
  it('HTTP 删除订阅无空 JSON 正文；旧领取路由不再存在',async()=>{
    const f=await fixture();
    expect(await f.client(false,'admin').call('subscriptions.remove',{name:'all'})).toEqual({removed:true});
    for(const path of ['receive','ack','renew'])expect((await fetch(`${f.baseUrl}/api/${path}`,{method:'POST'})).status).toBe(404);
  });
  it('仅内部调度器等待消息；发布直接唤醒，取消不留领取者',async()=>{
    const f=await fixture();
    const abort=new AbortController();
    const cancelled=f.worker.call('delivery.claim','admin',{endpoint:'agent',wait_ms:30_000},abort.signal);
    abort.abort();await expect(cancelled).rejects.toBeDefined();
    const pending=f.worker.call<{batch:MessageBatch}>('delivery.claim','admin',{endpoint:'agent',wait_ms:1000});
    await f.client(true).send({type:'note',content:'wake'});
    expect((await pending).batch.messages[0]!.content).toBe('wake');
  });
  it('IPC 身份发现复用握手，管理和发送使用同一凭据',async()=>{
    const f=await fixture(),manager=f.client(true,'admin');
    expect(await manager.call('authenticate')).toEqual({identity:'owner',manager:true});
    expect(await manager.call('authenticate')).toEqual({identity:'owner',manager:true});
    await manager.call('subscriptions.put',{name:'owner-notes',endpoint:'agent',source:'owner'});
    const sent=await manager.send({type:'note',content:'one credential'});
    expect(sent.recipients).toEqual(['agent']);
  });
  it('非 socket 路径和活动 socket 绝不覆盖',async()=>{
    const f=await fixture();await expect(listenMessagingIPC(f.socketPath,f.worker)).rejects.toThrow('占用');
    const file=`${f.socketPath}.file`;writeFileSync(file,'keep');
    await expect(listenMessagingIPC(file,f.worker)).rejects.toThrow('拒绝覆盖');
  });
  it('帧支持逐字节、合并帧及超限拒绝',()=>{
    const values:unknown[]=[],decoder=new FrameDecoder();
    for(const byte of Buffer.concat([encodeFrame({content:'中文'}),encodeFrame([1,2])]))decoder.push(Buffer.from([byte]),value=>values.push(value));
    expect(values).toEqual([{content:'中文'},[1,2]]);
    const bad=Buffer.alloc(4);bad.writeUInt32BE(1_048_577);expect(()=>new FrameDecoder().push(bad,()=>{})).toThrow('长度');
  });
});
