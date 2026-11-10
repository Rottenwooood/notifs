# 阶段 4：通用角色与中心主动交付

实现提交：`82452b2`；文档修正：`e3df34d`。仅有管理身份与普通身份，无内置主 agent 或子 agent 角色。

运行逻辑：发送身份经 HTTP/IPC（agent 可经 MCP）发布 → 编译后的订阅路由 → SQLite 原子保存消息与各目标投递 → 中心内部调度器调用适配器 → 平台/程序/宿主接管后确认。失败保留并重投。外部接收方不领取；租约仅是中心内部机制。

- MCP 只提供发送、查询及按身份授予的管理工具；删除公共 receive/ack/renew 和默认 pull 目标。
- endpoint.delivery 必填；适配器类型不再写死在核心契约枚举。程序走 webhook，OpenCode adapter 调用 2.x 的持久输入接口；其他 agent 宿主需接入其 adapter。
- 结构化正文贯穿核心与队列；渠道渲染放在适配器边界。
- 人可有多个目标/渠道；现有聊天平台 adapter 为出站通知，平台入站、Discord、Windows 桌面、反向连接桥接尚未实现。不宣称全部 agent 宿主兼容或完成性能验收。

## 真实外部验收

固定 OpenCode Go `opencode-go/deepseek-v4.1-flash`，验收会话 `ses_e3c0d0a4affew5OrsMq2fsO0b3`。原始材料保存在隔离目录 `/tmp/notifs-unified-0yXenn`，运行时在 `/tmp/notifs-push-eDOcfL`。私有凭据不入库。

[外部结果](stage-4-result.json)与[真实接收会话证据](stage-4-receiver.json)。接收会话 `ses_e3c0bf0a3ffe0QnVjfD9gCdWEF` 的 user 输入包含中心推送的完整消息，DeepSeek assistant 回复 `PUSH_CONTEXT_OK_S3-K7Q2M`；未调用接收工具。独立 webhook 的 503 → 204 重投及 SIGKILL 后自动恢复由外部客户端操作。

七项场景通过；文档修正后的五项有限复验通过。初测 F1 及其修正结论完整保存在结果 JSON 中，没有覆盖初测记录。

辅助检查：46 项回归通过、类型检查与构建通过；不替代外部验收。外部验收中的 HTTP 把 to 放正文、把自定义 IPC 当 HTTP、发送来源不匹配订阅等调用误用应与产品失败区分；HTTP 定向参数已在配置手册明确为 X-Notifs-To。

## 文件级修改及目录树

以下为本阶段涉及文件；`[A]` 新增、`[M]` 修改。

```text
├── README.md [M] — 实际运行链路与三类接入配置
├── apps/
│   ├── cli/
│   │   └── src/
│   │       ├── commands.ts [M] — 删除领取/确认命令；目标显式指定 adapter
│   │       └── main.ts [M] — 删除 wait/lease 选项
│   └── server/
│       └── src/
│           ├── adapters.ts [M] — 所有目标由中心主动调度与确认
│           ├── http.ts [M] — 移除公共领取和租约路由
│           ├── ipc.ts [M] — 禁止通过 IPC 调用内部投递操作
│           └── kernel-worker.ts [M] — 内部投递等待、到期与发布唤醒
├── docs/
│   ├── configuration.md [M] — 发送/接收/管理配置及实际平台边界
│   ├── design/
│   │   ├── notifs.html [M] — 同步生成设计页面
│   │   └── notifs.md [M] — 主动交付与通用角色边界
│   ├── mcp.md [M] — 真实发送与管理工具，区别宿主注入
│   └── validation/
│       ├── README.md [M] — 当前阶段与历史记录分开
│       ├── stage-3.md [M] — 明确旧 pull 验收仅为历史
│       ├── stage-4-receiver.json [A] — 接收会话实际输入与模型回复
│       ├── stage-4-result.json [A] — 真实外部验收结果与核对信息
│       └── stage-4.md [A] — 本阶段文件级报告与目录树
├── packages/
│   ├── adapters/
│   │   └── src/
│   │       ├── delivery.ts [A] — 在适配器边界转换与渲染消息
│   │       ├── index.ts [M] — 注册 OpenCode 校验和批次交付入口
│   │       └── opencode.ts [A] — 真实会话输入 API、稳定宿主消息 ID、环境凭据
│   ├── contracts/
│   │   └── src/
│   │       └── index.ts [M] — 投递配置必填、adapter kind 通用、内部操作分界
│   ├── core/
│   │   └── src/
│   │       ├── client.ts [M] — 公开客户端仅发布、查询与管理
│   │       └── kernel.ts [M] — 内部调度操作使用管理凭据
│   └── mcp/
│       └── src/
│           └── index.ts [M] — 通用管理角色，移除接收工具
└── tests/
    ├── messaging-transports.test.ts [M] — 主动 webhook 交付、公共入口删除及内部唤醒回归
    └── messaging.test.ts [M] — 内核回归转为内部交付操作，去除专属角色示例
```
