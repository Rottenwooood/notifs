# 阶段 5：统一 adapter 边界、飞书入站与 agent synthetic 注入

实现范围：所有目标统一为“接收完整批次、返回投递结果”的 adapter；人类渠道在 adapter 边缘从 `content` 渲染，一个限频窗口合并成一条消息；OpenCode 改用 synthetic input，不再把 JSON 当用户提示词；新增独立飞书入站 bridge。

## 验证

- `pnpm typecheck` 通过
- `pnpm test`：8 个测试文件、53 项通过
- `pnpm build`：`dist/server.mjs`、`dist/cli.mjs`、`dist/feishu-inbound.mjs`
- 构建产物 HTTP 冒烟：启动 `dist/server.mjs`，用独立身份、目标和订阅；飞书事件经 `dist/feishu-inbound.mjs` 进入中心；OpenCode 目标收到 `/api/session/ses_test/synthetic`，`delivery=steer`，正文为 `<agent-messages>` 且 `trust=untrusted-data`；两条快速消息在人类 webhook 目标合并为一个批次。
- OpenCode 2.0.24 的 OpenAPI 已确认提供 `/api/session/{id}/synthetic`、`delivery` 和 `metadata`；本阶段未调用真实模型，避免在用户环境产生模型费用。

## 文件

- `packages/contracts/src/index.ts`：`DeliveryAdapter`、`DeliveryContext`
- `packages/adapters/src/render.ts`：adapter 侧单条/批次渲染
- `packages/adapters/src/index.ts`：统一注册表，单条 adapter 包装为批次契约
- `packages/adapters/src/delivery.ts`：只调用 adapter，不再识别 webhook/opencode
- `packages/adapters/src/opencode.ts`：synthetic 注入与 `<agent-messages>` 块
- `packages/adapters/src/webhook.ts`：webhook 适配器对象
- `packages/adapters/src/feishu-inbound.ts` / `feishu-inbound-server.ts`：飞书事件解析与 bridge
- `apps/feishu-inbound/src/main.ts`：独立入站进程
- `tools/build.mjs`、`package.json`：构建与 bin
- `tests/opencode.test.ts`、`tests/feishu-inbound.test.ts`、adapter 回归

## 边界

- 飞书入站的长连接实现已加入；因本机没有飞书应用凭据，真实飞书连接未执行。HTTP 回调模式仅校验 verification token，未实现 encrypt key/签名解密。
- Discord、Windows 桌面尚未实现。
- 真实 OpenCode 模型注入已执行：在 OpenCode Go `deepseek-v4.1-flash` 会话 `ses_e3b0da2e2ffezwIRBSdmVXuIPw` 中注入 synthetic 消息，模型回复 `NOTIFS_SYNTHETIC_OK`；synthetic 会话消息类型为 `synthetic`，不是 `user`。
