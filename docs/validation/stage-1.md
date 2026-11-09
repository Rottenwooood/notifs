# 阶段 1：团队通信基础链路

- 分支：`codex/team-messaging`。
- 实现提交：`b480c61`；外部缺陷修复：`a542bbd`。
- 外部客户端：OpenCode v2.0.24，OpenCode Go `opencode-go/deepseek-v4.1-flash`。
- 会话：`ses_e3e94aafeffeeiJ0IV5gLwga5P`；隔离配置、数据库与本地端口。
- 验收方式：模型实际执行已构建的 CLI、curl HTTP、Unix socket，以及真实服务强杀与重启；未以内核直接调用或类型检查代替。

## 结果

8 项场景通过：身份与订阅、中文结构化消息双端交付、定向与未路由、幂等及冲突、管理/接收隔离、三条消息完整单批、SIGKILL 后恢复、v1 外部兼容。

另发现 `subscription rm` 的 HTTP 400 缺陷，未把初测直接判为最终通过。`a542bbd` 修复后，同模型实际通过 CLI 完成创建、删除、重复删除、列表验证，并重新完成发布—IPC 领取—确认。复验通过，阶段完成。

[原始脱敏结果](stage-1-result.json) · [修复后外部复验](stage-1-retest.json)。证据已检查不含身份或管理 token；完整会话日志留在本机私有临时目录，未提交。

## 文件级变更与目录树

以下为 `bf7ad4c..a542bbd` 的全部变更文件，每项标明职责：

```text
├── README.md — 增加团队通信入口
├── apps/
│   ├── cli/
│   │   └── src/
│   │       ├── main.ts — 接入管理与通信命令及 MCP v2
│   │       └── messaging.ts — 外部 CLI 操作
│   └── server/
│       └── src/
│           ├── app.ts — 注册 v2 HTTP 路由
│           ├── main.ts — 启动内核、IPC 与渠道桥
│           ├── messaging-admin.ts — 独立管理凭据
│           ├── messaging-channels.ts — 通知渠道边缘适配
│           ├── messaging-http.ts — 真实 HTTP 入口
│           ├── messaging-ipc.ts — 本地 IPC 认证与连接
│           ├── messaging-worker-bootstrap.mjs — 开发态 Worker 启动
│           ├── messaging-worker.ts — 独立线程与有界等待
│           └── messaging.ts — 主线程至内核的操作边界
├── docs/
│   ├── design/
│   │   ├── notifs-v2.html — 可离线架构页面
│   │   └── notifs-v2.md — 已确认架构
│   └── messaging.md — 实际入口与边界
├── packages/
│   ├── contracts/
│   │   └── src/
│   │       ├── index.ts — 导出新契约
│   │       └── messages.ts — 两字段消息与协议操作
│   ├── core/
│   │   └── src/
│   │       ├── index.ts — 导出客户端
│   │       └── messaging/
│   │           ├── client.ts — HTTP/IPC 客户端；修复无请求体 DELETE
│   │           ├── framing.ts — IPC 帧编解码
│   │           ├── kernel.ts — 身份、订阅与消息编排
│   │           └── router.ts — 纯计算订阅匹配
│   ├── mcp/
│   │   └── src/
│   │       ├── index.ts — 导出 MCP v2
│   │       └── messaging.ts — 外部 MCP v2 工具
│   └── store/
│       └── src/
│           ├── index.ts — 导出消息存储
│           ├── messages-schema.ts — 追加数据库迁移
│           ├── messages.ts — 原子持久投递与租约
│           └── schema.ts — 注册追加迁移
├── tests/
│   ├── messaging-channels.test.ts — 辅助：渠道接管回归
│   ├── messaging-transports.test.ts — 辅助：传输回归及 DELETE 缺陷回归
│   └── messaging.test.ts — 辅助：内核回归
└── tools/
    ├── build.mjs — 打包独立 Worker
    ├── e2e-messaging.mjs — 辅助：脚本 smoke，非阶段验收
    └── render-notifs-design.py — 生成简短设计页面
```
