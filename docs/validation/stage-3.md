# 阶段 3：彻底移除旧架构，落地实际配置入口

- 实现：`6901f58`；IPC/MCP 身份修复：`7f1eb6c`；辅助回归：`ccc4467`。
- 用户已确认：人通过 CLI 管理，Last Order 通过 MCP 管理；订阅是唯一通信关系规则。
- 实际外部客户端：OpenCode Go `opencode-go/deepseek-v4.1-flash`。
- 有效复验会话：`ses_e3c7965ecffeaw9wOcaGYSjBIL`，已核对会话导出的 provider/model。

## 配置结果

身份通过一个 token 同时发送、接收及执行获准管理操作。Last Order 的 manager 标记决定是否暴露身份、目标、订阅 MCP 工具；不是第二套发送权限规则。

接收目标直接配置 delivery：agent/程序可 pull，程序可 webhook，通知 adapter 在目标内配置。没有 channel 对象、旧 rule 引擎、旧 outbox、监控托管、版本模式或兼容 CLI/API。新的默认库是 hub.db；旧用户文件没有删除或隐式迁移。

## 外部验收结果

9 项通过：

1. 文档、help 与 Last Order 管理工具可用。
2. Last Order 通过真实 set_endpoint/set_subscription 建立三条通信关系。
3. 人 CLI → Last Order MCP → sister MCP → Last Order MCP，同一身份管理和收发。
4. 人 CLI 与 Last Order MCP 双向修改、查看和删除同一套订阅。
5. 独立 program 身份通过 curl 发布、拉取、确认。
6. 独立 HTTP webhook 程序收到两条完整中文/数组消息，返回 204 后确认。
7. 普通身份隔离、to 缩小范围、未路由、幂等与冲突。
8. 旧 HTTP 路径 404，旧 CLI 与 --v2 开关拒绝。
9. 真实 SIGKILL、保留库和 socket 后重启，MCP 重连并领取确认。

初次运行发现 IPC 重复认证使 MCP 启动断开，修复保存为 `7f1eb6c`。初次会话未注册管理工具，其后手写 MCP 协议请求不计入验收；已停止该轮，使用全新隔离会话从真实模型工具完整复验。未隐藏失败或用内部调用替代。

[结果与工具证据](stage-3-result.json)。当前外部验收覆盖 pull/webhook；其他通知适配器保留辅助测试，未宣称真实平台送达。性能与长期运行不属于本次通过范围。49 项内部回归为辅助证据，不替代上述外部验收。

## 文件级修改与目录树

A=新增，M=修改，D=删除，R=移动。覆盖 `75da66f..ccc4467` 的全部变更；历史阶段记录仅供审计，不是当前使用说明。

```text
├── AGENTS.md [M] — 按用户新要求移除保留兼容入口的约定
├── README.md [M] — 直接说明人/Last Order、发送方与接收方如何配置
├── apps/
│   ├── cli/
│   │   ├── package.json [M] — 调整统一内核依赖，移除旧模块
│   │   └── src/
│   │       ├── commands.ts [R061] — 单一身份凭据，身份/目标/订阅操作；原 apps/cli/src/messaging.ts
│   │       └── main.ts [M] — 仅保留统一 init/start/mcp 与配置、通信命令；拒绝旧开关
│   └── server/
│       ├── package.json [M] — 调整统一内核依赖，移除旧模块
│       └── src/
│           ├── adapters.ts [A] — 按 endpoint.delivery 消费同一持久队列
│           ├── app.ts [M] — 删除旧 API，健康检查覆盖真实内核
│           ├── config.ts [M] — 统一 NOTIFS_* 与新 hub.db 路径
│           ├── credentials.ts [A] — 人默认 controller-token；不再读取旧凭据
│           ├── http.ts [R062] — 单一 /api 入口，新增身份管理；原 apps/server/src/messaging-http.ts
│           ├── ingest.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│           ├── ipc.ts [R099] — 同一认证/操作协议，无版本分支；原 apps/server/src/messaging-ipc.ts
│           ├── kernel-bootstrap.mjs [A] — 开发态线程加载
│           ├── kernel-host.ts [R091] — 内核线程操作边界；原 apps/server/src/messaging.ts
│           ├── kernel-worker.ts [R097] — 单一状态内核与长等待；原 apps/server/src/messaging-worker.ts
│           ├── main.ts [M] — 只启动一个内核与 adapter 消费者
│           ├── messaging-admin.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│           ├── messaging-channels.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│           ├── messaging-worker-bootstrap.mjs [D] — 删除旧架构代码、旧测试或过期接入文档
│           └── worker.ts [D] — 删除旧架构代码、旧测试或过期接入文档
├── bin/
│   └── nh [D] — 删除旧架构代码、旧测试或过期接入文档
├── deploy/
│   ├── README.md [M] — 单中心部署，不引用删除的通知管道
│   ├── desktop-sink.mjs [D] — 删除旧架构代码、旧测试或过期接入文档
│   ├── notifs-desktop-sink.service [D] — 删除旧架构代码、旧测试或过期接入文档
│   └── notifs-tunnel.service [D] — 删除旧架构代码、旧测试或过期接入文档
├── docs/
│   ├── channels.md [D] — 删除旧架构代码、旧测试或过期接入文档
│   ├── configuration.md [A] — 集中说明身份、发送方、接收方与订阅设置
│   ├── design/
│   │   ├── notifs.html [R089] — 生成当前简短架构页面；原 docs/design/notifs-v2.html
│   │   └── notifs.md [R084] — 仅当前架构；原 docs/design/notifs-v2.md
│   ├── mcp.md [M] — Last Order 管理工具与普通 agent 的实际配置
│   ├── messaging.md [D] — 删除旧架构代码、旧测试或过期接入文档
│   ├── producer-protocol.md [D] — 删除旧架构代码、旧测试或过期接入文档
│   ├── remote.md [D] — 删除旧架构代码、旧测试或过期接入文档
│   ├── usage.md [D] — 删除旧架构代码、旧测试或过期接入文档
│   └── validation/
│       └── README.md [M] — 保留历史证据，当前入口转到新配置手册
├── package.json [M] — 破坏式改造标为 alpha，移除旧依赖并收录配置文档
├── packages/
│   ├── adapters/
│   │   ├── package.json [R083] — 调整统一内核依赖，移除旧模块；原 packages/channels/package.json
│   │   └── src/
│   │       ├── bark.ts [R086] — 仅作为统一目标的边缘适配器，去除旧 channel 耦合；原 packages/channels/src/bark.ts
│   │       ├── feishu-app.ts [R086] — 仅作为统一目标的边缘适配器，去除旧 channel 耦合；原 packages/channels/src/feishu-app.ts
│   │       ├── feishu.ts [R093] — 仅作为统一目标的边缘适配器，去除旧 channel 耦合；原 packages/channels/src/feishu.ts
│   │       ├── index.ts [A] — 独立适配器注册与 delivery 配置验证
│   │       ├── local.ts [R072] — 仅作为统一目标的边缘适配器，去除旧 channel 耦合；原 packages/channels/src/local.ts
│   │       ├── ntfy.ts [R084] — 仅作为统一目标的边缘适配器，去除旧 channel 耦合；原 packages/channels/src/ntfy.ts
│   │       ├── webhook.ts [A] — 直接向程序交付完整批次，不再渲染为旧通知正文
│   │       └── wecom.ts [R086] — 仅作为统一目标的边缘适配器，去除旧 channel 耦合；原 packages/channels/src/wecom.ts
│   ├── channels/
│   │   └── src/
│   │       ├── index.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   │       └── webhook.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   ├── contracts/
│   │   └── src/
│   │       ├── index.ts [M] — 仅统一消息、身份、目标、订阅与适配器契约
│   │       ├── messages.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   │       └── protocol.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   ├── core/
│   │   ├── package.json [M] — 调整统一内核依赖，移除旧模块
│   │   └── src/
│   │       ├── client.ts [R079] — 单一 API 客户端，复用 IPC 握手身份；原 packages/core/src/messaging/client.ts
│   │       ├── framing.ts [R100] — 公共 IPC 帧协议；原 packages/core/src/messaging/framing.ts
│   │       ├── index.ts [M] — 导出统一内核与客户端
│   │       ├── kernel.ts [R080] — 同一身份支持管理与通信，配置验证；原 packages/core/src/messaging/kernel.ts
│   │       ├── router.ts [R100] — 纯订阅路由，无旧 rule 引擎；原 packages/core/src/messaging/router.ts
│   │       ├── rules.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   │       └── template.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   ├── mcp/
│   │   ├── package.json [M] — 调整统一内核依赖，移除旧模块
│   │   └── src/
│   │       ├── client.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   │       ├── index.ts [M] — 按身份提供收发和 Last Order 管理工具，无模式切换
│   │       └── messaging.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   ├── producers/
│   │   ├── package.json [D] — 删除旧架构代码、旧测试或过期接入文档
│   │   └── src/
│   │       ├── check.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   │       ├── index.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   │       ├── interval.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   │       ├── jsonpath.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   │       ├── manifest.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   │       ├── poller.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   │       ├── register.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   │       ├── scaffold.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   │       └── trial.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   ├── store/
│   │   ├── package.json [M] — 调整统一内核依赖，移除旧模块
│   │   └── src/
│   │       ├── crypto.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   │       ├── index.ts [M] — 独立身份存储与队列，脱离旧 Store；旧库拒绝且保留
│   │       ├── messages-schema.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   │       ├── messages.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   │       └── schema.ts [M] — 仅当前内核表，不创建旧通知或托管表
│   └── supervisor/
│       ├── package.json [D] — 删除旧架构代码、旧测试或过期接入文档
│       └── src/
│           ├── index.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│           ├── poller-scheduler.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│           └── supervisor.ts [D] — 删除旧架构代码、旧测试或过期接入文档
├── pnpm-lock.yaml [M] — 刷新为清理后的八个 workspace
├── pnpm-workspace.yaml [M] — 移除 producer workspace
├── producers/
│   ├── README.md [D] — 删除旧架构代码、旧测试或过期接入文档
│   ├── feishu-events/
│   │   ├── README.md [D] — 删除旧架构代码、旧测试或过期接入文档
│   │   ├── index.mjs [D] — 删除旧架构代码、旧测试或过期接入文档
│   │   ├── package.json [D] — 删除旧架构代码、旧测试或过期接入文档
│   │   └── producer.json [D] — 删除旧架构代码、旧测试或过期接入文档
│   └── routine/
│       ├── README.md [D] — 删除旧架构代码、旧测试或过期接入文档
│       ├── index.mjs [D] — 删除旧架构代码、旧测试或过期接入文档
│       ├── package.json [D] — 删除旧架构代码、旧测试或过期接入文档
│       └── producer.json [D] — 删除旧架构代码、旧测试或过期接入文档
├── tests/
│   ├── adapters-integration.test.ts [R064] — 当前身份、订阅、adapter 与传输的辅助回归；原 tests/messaging-channels.test.ts
│   ├── adapters.test.ts [R069] — 当前身份、订阅、adapter 与传输的辅助回归；原 tests/channels.test.ts
│   ├── agent-api.test.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   ├── ask.test.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   ├── envelope.test.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   ├── feishu-app.test.ts [M] — 当前身份、订阅、adapter 与传输的辅助回归
│   ├── feishu.test.ts [M] — 当前身份、订阅、adapter 与传输的辅助回归
│   ├── helpers.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   ├── ingest-http.test.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   ├── ingest.test.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   ├── loop-guard.test.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   ├── messaging-transports.test.ts [M] — 当前身份、订阅、adapter 与传输的辅助回归
│   ├── messaging.test.ts [M] — 当前身份、订阅、adapter 与传输的辅助回归
│   ├── outbox.test.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   ├── poller.test.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   ├── register.test.ts [D] — 删除旧架构代码、旧测试或过期接入文档
│   └── supervisor.test.ts [D] — 删除旧架构代码、旧测试或过期接入文档
└── tools/
    ├── build.mjs [M] — 打包当前 kernel worker
    ├── render-notifs-design.py [M] — 只生成当前架构页面
    ├── run.sh [M] — 只加载当前 NOTIFS 配置并启动统一中心
    ├── smoke-messaging.mjs [D] — 删除旧架构代码、旧测试或过期接入文档
    └── smoke-resend.sh [D] — 删除旧架构代码、旧测试或过期接入文档
```
