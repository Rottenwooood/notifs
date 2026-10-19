import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { PRODUCER_PROTOCOL } from '@notify-hub/contracts';
import { NotifyClient } from './client.ts';

const VERSION = '0.1.0';

/** 默认 token 文件（notifs init 写入，600）。 */
export const TOKEN_PATH = '~/.config/notifs/token';

const INSTRUCTIONS = `notifs 是用户本机的通知中继。
- 在"有意义的进展 / 失败 / 完成"时用 send 发一条；不要每做一小步就发——通知会被静音。
- 几个小步骤合并成一条。
- 需要用户做决定、或要等他确认时，用 ask：发一条并等他"引用回复"那条消息，默认等 5 分钟、最多 30。
- 想知道消息到底送达没有，用 deliveries 查（sent / pending / dead）。
- 需要写长期运行的监控程序时，用 write-script / write-monitor 提示词，或读 notifs://contract。`;

function text(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function fail(err: unknown) {
  return {
    content: [{ type: 'text' as const, text: `失败：${err instanceof Error ? err.message : String(err)}` }],
    isError: true,
  };
}

function scriptPrompt(event: string, baseUrl: string): string {
  return `写一个程序：当 ${event} 的时候，向 ${baseUrl} 发一个 POST 通知我。
type 你自己起个合适的（点分层级，如 experiment.finished；别用中文句子）。

    POST ${baseUrl}/api/v1/events
    Authorization: Bearer <token>        # 取 ${TOKEN_PATH}；没有就先跑 notifs init
    Content-Type: application/json
    {"type":"experiment.finished","text":"<正文>"}

只有 type 和 text 必填，多写别的字段会被 400 拒绝。202 就是成功
（deduplicated:true 也算），不用重试。`;
}

function monitorPrompt(need: string): string {
  return `用 notifs 托管一个监控程序。需求：${need}

步骤：
1. notifs watcher init <slug>，然后改 producers/<slug>/：
   - producer.json：填 config、credentials（只写名字）、description
   - index.mjs：把 checkOnce() 里的 TODO 换成真实判定逻辑
2. 自己跑通再交付：notifs watcher check <slug>，notifs watcher try <slug> --seconds 15
3. 告诉我上线命令（notifs watcher enable <slug>）、需要我手动存哪个 secret，
   并在 README.md 写清"它会以什么方式坏、我多久能发现"。

两个最容易错的地方：
- dedup_key 要带"这一次执行"的标识（run id / 启动时间），别用固定值，也别用纯时间戳。
- 异常用 degraded 心跳上报，别静默。

契约（完整版见 notifs://contract）：
- 环境变量：NOTIFY_BASE_URL / NOTIFY_TOKEN / NOTIFY_PRODUCER_ID / NOTIFY_STATE_DIR / NOTIFY_CONFIG
- 心跳：每 30s POST {BASE}/api/v1/producers/{ID}/heartbeat，异常用 {"status":"degraded","detail":"..."}
- 断点写进 NOTIFY_STATE_DIR
- 退出码 0 = 正常结束，非 0 = 异常（退避重启）`;
}

function pollerPrompt(need: string): string {
  return `用 notifs 的声明式 poller 监控：${need}。不写代码。

步骤：
1. notifs watcher init <slug> --kind poller
2. 填 producer.json 的 poller 字段：
   - request：url / method / headers（要密钥写 "{{secrets.名}}"）+ interval
   - extract + key：怎么从响应取出条目数组、条目的稳定标识
   - change.on：new_item / field_changed / threshold —— 说明为什么选它
   - map：条目 → 信封字段（$ = 整个条目；$.a.b = 取路径；"字面量" = 常量；
     "x{{ 表达式 }}y" = 字面量内插值，dedup_key 用这种）
3. notifs watcher check <slug> → try <slug> --seconds 15 → enable <slug>

如果这个源 poller 根本表达不了（需要登录态，或变化不是"新条目/字段变化/阈值"），
直接说，改成托管程序。`;
}

export interface McpOptions {
  baseUrl: string;
  token: string;
}

export async function startMcp(opts: McpOptions): Promise<void> {
  const client = new NotifyClient(opts);
  const server = new McpServer({ name: 'notifs', version: VERSION }, { instructions: INSTRUCTIONS });

  // ---- tools ----

  server.registerTool(
    'send',
    {
      title: '发送通知',
      description:
        '给用户发一条通知。type 用点分层级（如 experiment.finished），text 是给人看的正文。' +
        '只在中意的进展/失败/完成时发，别每步都发。',
      inputSchema: {
        type: z.string().min(1).max(200).describe('点分层级的事件类型，如 experiment.finished'),
        text: z.string().min(1).max(20_000).describe('通知正文'),
        title: z.string().max(500).optional().describe('通知标题'),
        url: z.string().url().optional().describe('点通知可跳转的链接'),
        severity: z.enum(['info', 'warn', 'critical']).optional(),
        dedup_key: z
          .string()
          .min(1)
          .max(500)
          .optional()
          .describe('同一件事的稳定唯一标识；不填则按 (源,type,text) 去重 24 小时'),
        data: z.record(z.string(), z.unknown()).optional().describe('结构化附加数据'),
      },
    },
    async (args) => {
      try {
        return text(await client.send(args));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'ask',
    {
      title: '提问并等待回复',
      description:
        '发一条通知并等用户回复。用户必须"引用回复"那条消息才能匹配上。' +
        '默认等 5 分钟，最多 30。等到就返回他的原话，超时返回 status:"expired"。',
      inputSchema: {
        text: z.string().min(1).max(20_000).describe('要问的正文'),
        timeout_minutes: z.number().int().min(1).max(30).optional().describe('默认 5，最多 30'),
        type: z.string().min(1).max(200).optional().describe('默认 question.ask'),
        title: z.string().max(500).optional(),
        severity: z.enum(['info', 'warn', 'critical']).optional(),
        data: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async (args) => {
      try {
        const created = (await client.ask({
          ...args,
          type: args.type ?? 'question.ask',
          timeout_minutes: args.timeout_minutes ?? 5,
        })) as { ask_id?: string; expires_at?: string };
        if (!created.ask_id) return fail(new Error('中心没有返回 ask_id'));

        // 服务端到点会把 ask 标成 expired，这里只需不断长轮询
        for (;;) {
          const r = await client.askGet(created.ask_id, 300);
          if (r.status !== 'pending') return text(r);
          if (created.expires_at && Date.parse(created.expires_at) + 15_000 < Date.now()) {
            return text({ ...r, status: 'expired' });
          }
        }
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'events',
    {
      title: '查看最近事件',
      description: '看自己这个源最近发出去的事件（含被去重的之外的入库记录）。',
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().describe('默认 20'),
        type: z.string().optional().describe('只按这个 type 精确过滤'),
      },
    },
    async ({ limit, type }) => {
      try {
        return text(await client.events(limit ?? 20, type));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'deliveries',
    {
      title: '查看投递状态',
      description: '回答"到底送到没有"：sent 已送达，pending 重试中，dead 死信。',
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().describe('默认 20'),
        status: z.enum(['pending', 'sending', 'sent', 'dead']).optional(),
      },
    },
    async ({ limit, status }) => {
      try {
        return text(await client.deliveries(limit ?? 20, status));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'status',
    {
      title: '查看中继状态',
      description: '一眼看源、出口、规则、托管程序和投递计数。',
      inputSchema: {},
    },
    async () => {
      try {
        return text(await client.status());
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ---- prompts（变成 /notifs:write-script 这类斜杠命令）----

  server.registerPrompt(
    'write-script',
    {
      title: '写一个发 POST 的脚本',
      description: '生成"当某事发生时，向本机 notifs 发 POST"的提示词',
      argsSchema: { event: z.string().describe('什么事发生时通知，如 "实验跑完"') },
    },
    ({ event }) => ({
      messages: [
        { role: 'user', content: { type: 'text', text: scriptPrompt(event, opts.baseUrl) } },
      ],
    }),
  );

  server.registerPrompt(
    'write-monitor',
    {
      title: '写一个托管监控程序',
      description: '生成"由 notifs 托管、带心跳和断点"的监控程序提示词',
      argsSchema: { need: z.string().describe('监控什么、什么算变化') },
    },
    ({ need }) => ({
      messages: [{ role: 'user', content: { type: 'text', text: monitorPrompt(need) } }],
    }),
  );

  server.registerPrompt(
    'poller',
    {
      title: '写一个声明式 poller',
      description: '不写代码，只写轮询配置',
      argsSchema: { need: z.string().describe('接口地址、什么算变化') },
    },
    ({ need }) => ({
      messages: [{ role: 'user', content: { type: 'text', text: pollerPrompt(need) } }],
    }),
  );

  // ---- resources ----

  server.registerResource(
    'contract',
    'notifs://contract',
    {
      title: 'notifs 接入契约',
      description: '事件信封、去重规则、托管程序与 poller 约定',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: PRODUCER_PROTOCOL }],
    }),
  );

  await server.connect(new StdioServerTransport());
}
