# 团队通信 v2

新入口与已有通知 API 并存。普通消息仅有 `type`、`content`；身份由 token 确定。没有发送权限规则或回复字段，订阅由人或 Last Order 使用管理凭据配置。指定 `to` 只能缩小订阅目标。

## 最小闭环

先运行 `notifs init` 和 `notifs start`。管理凭据自动保存在配置目录的 `admin-token`，与普通身份的 `token` 分开；也可设置 `NOTIFS_ADMIN_TOKEN`。

```sh
notifs identity add sender
notifs identity add sister
# 分别保存输出的 token；不会覆盖同名身份的已有凭据

notifs endpoint put --config '{"name":"sister","owner":"sister"}'
notifs subscription put --config '{"name":"input","endpoint":"sister","source":"sender","type":"message"}'

NOTIFS_TOKEN='<sender 的 token>' notifs message send '请检查这个结果' --type message --to sister
NOTIFS_TOKEN='<sister 的 token>' notifs message receive sister --wait 30
# 接管完整批次后，用上一步返回的 id 和 lease 确认：
NOTIFS_TOKEN='<sister 的 token>' notifs message ack '<batch-id>' --lease '<lease>'
```

`--content '{"result":[1,2]}'` 可代替文本。`--id <稳定标识>` 用于跨命令重试；相同 ID、相同内容和目标返回原结果，内容或目标变化则报冲突。不同发送者的 ID 独立。无 ID 的新调用视为一次新发布，不按相同正文去重。

## HTTP 与本地 IPC

```http
POST /api/v2/messages
Authorization: Bearer <身份 token>
Idempotency-Key: <可选的稳定重试标识>
X-Notifs-To: sister
Content-Type: application/json

{"type":"message","content":"请检查这个结果"}
```

HTTP 返回 `id`、`recipients`、`deduplicated`。无订阅匹配返回 `422 unrouted`，没有接受消息。领取用 `POST /api/v2/receive`，正文为 `{"endpoint":"sister","wait_ms":30000}`；确认用 `/api/v2/ack`，正文为 `{"id":"批次ID","lease":"租约"}`。`/api/v2/renew` 使用相同参数续租。

CLI 加 `--socket <数据目录>/notifs.sock` 即可改走 IPC。默认 socket 位于数据目录，可用 `NOTIFS_SOCKET` 更改。IPC 使用 4 字节大端长度和 JSON 帧；首先 authenticate，后续连接不允许切换身份。socket 权限为 600。

TypeScript 集成使用 `packages/core/src/messaging/client.ts` 的 `MessageClient`：

```ts
const client = new MessageClient({ token, socketPath }); // 或 baseUrl
await client.send({ type: 'message', content: { result: [1, 2] } });
const { batch } = await client.receive('sister', 30_000);
// 将整批可靠交给运行时后，再 await client.ack(batch)
client.close();
```

`notifs mcp --v2` 提供 send、receive、ack、inspect；可选 `--socket <路径>`。默认 `notifs mcp` 继续使用旧通知协议。MCP 工具不会自行启动已经退出的 agent；宿主通过 receive 接收后，自行决定如何调度模型。

## 订阅与批量

订阅的 `source`、`type` 支持 `*` 任意字符通配；`all` 可以筛选 content：

```json
{"name":"failures","endpoint":"sister","source":"test-runner","type":"test.*","all":[{"field":"result.failed","op":"gt","value":0}]}
```

运算符为 eq、ne、in、exists、gt、lt。订阅变更只影响后续发布，重试仍返回原消息的目标。同目标多订阅命中只投一次。

接收目标可配置 `max_wait_ms`、`min_interval_ms`、`max_messages`、`max_bytes`。默认最多 32 条、256 KiB，攒批和限频等待为 0；将 max_wait_ms 设为 200 可在 200ms 内合并输入。不同模型上下文注册不同目标。合并保留所有内容和顺序，不生成摘要。

目标加 `paused:true` 可停止交付，后续消息继续排队。30 秒未确认的批次可以重新领取，旧 lease 失效；重试保留原批次成员。自动尝试 20 次后保留为 held，使用 `notifs endpoint resume <name>` 恢复，不丢弃消息。`ack` 只确认整批接管，不代表任务完成。运行时必须按消息 ID 去重，不能把至少一次投递当成外部动作恰好执行一次。

默认待投递上限 100000 项、保存消息内容上限 512 MiB，触顶拒绝新提交；不会删除已接受消息。当前版本保留历史和幂等记录，不自动清理；该字节额度不等于数据库文件的硬上限，长期部署需要关注磁盘。消息、投递引用和容量计数在同一事务提交，WAL + FULL；磁盘故障不属于单机可靠性保证。

## 现有通知渠道

可用已有的 channel 作为边缘接收目标：

```sh
notifs endpoint put --config '{"name":"phone","owner":"sister","channel":"已有渠道名"}'
notifs subscription put --config '{"name":"phone-input","endpoint":"phone","type":"important.*"}'
```

渠道适配器最后才把结构化内容渲染为文本。平台接受消息后确认批次，不等于用户已读；不支持幂等发送的平台可能显示重复通知。新协议不新增 ask/回复关联；旧 `/api/v1/ask` 为兼容现有调用继续保留。新消息与旧事件管道分别运行，不会隐式复制到另一条管道。
