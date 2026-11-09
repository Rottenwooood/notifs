# 阶段 2：清理与项目自洽

- 分支：`codex/team-messaging`。
- 实现提交：`faa7831`；README MCP 示例统一：`f1cf6ee`。
- 外部客户端：OpenCode v2.0.24，OpenCode Go `opencode-go/deepseek-v4.1-flash`。
- 会话：`ses_e3e8c77b4ffeHR54HMfvuypaUu`。已从会话导出元数据核对实际 provider/model，无替换。

## 外部验收

6 项全部通过：按文档配置与帮助、真实 MCP send/receive/inspect/ack、CLI 与 MCP 双向互通、CLI 删除订阅、HTTP/IPC 定向及未路由与管理隔离、旧 v1 local 渠道投递。

MCP 操作由模型实际调用已配置服务器，经 Unix socket 连接运行中的中心；CLI 是独立观察入口。没有导入内核或读取数据库来代替验收。未发现功能缺陷。

v1 local 的 sent 和 notify-send 成功只能证明适配器接受；隔离环境无法目视确认用户桌面显示，未宣称用户已读或手机送达。

[脱敏结果及实际工具证据](stage-2-result.json)。原始会话与导出保留在本机私有临时目录；报告提交前已检查不含身份及管理 token。辅助回归为 106 项通过，单独标记，不作为阶段外部验收的替代。

## 文件级变更与目录树

以下是 `9e91834..f1cf6ee` 的全部文件级变更。A=新增、M=修改、D=删除、R=重命名：

```text
├── AGENTS.md [A] — 新增阶段 Git 保存、指定模型外部验收和文件级汇报约定
├── README.md [M] — 统一产品定位、MCP 示例、工具数量、能力边界和文档入口
├── apps/
│   ├── cli/
│   │   └── src/
│   │       └── main.ts [M] — 删除 runChild / PROTOCOL_DOC_PATH 死代码，更新真实帮助入口
│   └── server/
│       └── src/
│           ├── ingest.ts [M] — 移除已删除旧方案的章节号引用；不改运行行为
│           └── worker.ts [M] — 移除已删除旧方案的章节号引用；不改运行行为
├── docs/
│   ├── channels.md [M] — 删除不存在的管理 UI，说明 v1/v2 渠道接入
│   ├── mcp.md [M] — 使用已验收的 OpenCode v2 配置，区分两种 MCP 模式
│   ├── producer-protocol.md [M] — 标明 v1 范围，纠正来源与限频承诺
│   ├── usage.md [M] — 替换重复过期内容，仅保留真实运行方式与边界
│   ├── validation/
│   │   └── README.md [A] — 新增外部阶段验收流程与证据规范
│   └── 使用手册.md [D] — 删除重复且含 author / llm / Web UI 过期描述的手册
├── packages/
│   ├── channels/
│   │   └── src/
│   │       ├── local.ts [M] — 移除已删除旧方案的章节号引用；不改运行行为
│   │       └── webhook.ts [M] — 移除已删除旧方案的章节号引用；不改运行行为
│   ├── contracts/
│   │   └── src/
│   │       └── index.ts [M] — 移除已删除旧方案的章节号引用；不改运行行为
│   ├── core/
│   │   └── src/
│   │       └── rules.ts [M] — 移除已删除旧方案的章节号引用；不改运行行为
│   ├── producers/
│   │   └── src/
│   │       ├── manifest.ts [M] — 移除已删除旧方案的章节号引用；不改运行行为
│   │       ├── poller.ts [M] — 移除已删除旧方案的章节号引用；不改运行行为
│   │       ├── register.ts [M] — 移除已删除旧方案的章节号引用；不改运行行为
│   │       └── trial.ts [M] — 移除已删除旧方案的章节号引用；不改运行行为
│   ├── store/
│   │   └── src/
│   │       ├── index.ts [M] — 移除已删除旧方案的章节号引用；不改运行行为
│   │       └── schema.ts [M] — 移除已删除旧方案的章节号引用；不改运行行为
│   └── supervisor/
│       └── src/
│           ├── poller-scheduler.ts [M] — 移除已删除旧方案的章节号引用；不改运行行为
│           └── supervisor.ts [M] — 移除已删除旧方案的章节号引用；不改运行行为
├── tests/
│   ├── channels.test.ts [M] — 移除已删除旧方案的章节号引用；不改运行行为
│   ├── envelope.test.ts [M] — 移除已删除旧方案的章节号引用；不改运行行为
│   ├── feishu.test.ts [M] — 移除已删除旧方案的章节号引用；不改运行行为
│   ├── ingest-http.test.ts [M] — 移除已删除旧方案的章节号引用；不改运行行为
│   ├── ingest.test.ts [M] — 移除已删除旧方案的章节号引用；不改运行行为
│   ├── outbox.test.ts [M] — 移除已删除旧方案的章节号引用；不改运行行为
│   ├── poller.test.ts [M] — 移除已删除旧方案的章节号引用；不改运行行为
│   ├── register.test.ts [M] — 移除已删除旧方案的章节号引用；不改运行行为
│   └── supervisor.test.ts [M] — 移除已删除旧方案的章节号引用；不改运行行为
├── tools/
│   ├── run.sh [M] — 纠正当前默认配置路径说明
│   ├── smoke-messaging.mjs [R098] — 由 e2e-messaging.mjs 改名，明确为辅助 smoke（原 tools/e2e-messaging.mjs）
│   └── smoke-resend.sh [R069] — 由 e2e-resend.sh 改名，隔离配置并使用构建后的 CLI（原 tools/e2e-resend.sh）
├── 技术方案.html [D] — 删除旧方案的重复 HTML 产物
└── 技术方案.md [D] — 删除与实际实现冲突的旧基准方案
```
