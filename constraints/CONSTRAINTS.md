# 约束清单

项目：notifs v0.2.0 发布

阶段：release-v0.2.0

## 约束

| 编号 | 约束 |
|---|---|
| C1 | 范围覆盖 v0.2.0 发布所需的 agent 接入契约、MCP/HTTP 出站、核心可靠性、飞书生产化、打包安装、验收、发布和生产切换；不做 OpenCode 专用回复桥、文本解析、form/permission adapter、Discord、Windows、HA、多节点和旧历史导入。 |
| C2 | 产物为 integrations/agent 接入说明、MCP/POST 硬化、核心保留清理与备份、飞书单实例锁、安装与迁移流程、验收记录、v0.2.0 包和发布说明。 |
| C3 | 入口为 pnpm typecheck、pnpm test、pnpm build、npm pack 干净安装、真实飞书 + agent MCP/POST 闭环，以及生产切换和回滚演练。 |
| C4 | 允许 pnpm、node、curl、git、timeout、ssh、npm、systemctl；允许在测试窗口停用 relay 的 feishu-events，并发送本次测试所需的真实飞书消息。 |
| C5 | 不 push、不改写远端、不回显凭据、不删除旧 notifs 数据、不使用 pkill/killall、不发布解析模型最终文本的回复桥。 |
| C6 | 持续到 P8；真实模型调用最多 5 次；生产切换前必须完成备份和回滚脚本；失败立即恢复旧 producer 并记录输出。 |

## 范围

做：
- agent 用 MCP send 或 HTTP POST 发回中心
- 中心向 agent 使用非 user_prompt 接口
- 核心保留清理、备份恢复、飞书单实例锁
- npm 打包、安装、迁移、验收和发布
- 生产切换与回滚

不做：
- 文本回复桥和模型输出解析
- form/permission adapter
- OpenCode 专用 adapter 后续开发
- Discord/Windows/HA/多节点/旧历史导入

## 产物

| 编号 | 路径 | 形态 |
|---|---|---|
| A1 | integrations/agent/README.md | agent MCP/POST 接入契约 |
| A2 | packages/core + packages/store + apps/server | 保留清理、备份恢复、单实例锁等可靠性 |
| A3 | apps/feishu-inbound/src/main.ts | 飞书单实例锁与生产化 |
| A4 | apps/cli/src/main.ts + docs/release-plan.md | 安装/服务/迁移与发布入口 |
| A5 | tests/*.test.ts | MCP/POST、清理、恢复、锁、飞书回归 |
| A6 | docs/validation/ | P6/P8 验收记录 |

## 验收

入口：pnpm typecheck && pnpm test && pnpm build

| 检查项 | 来源 | 判定 |
|---|---|---|
| K1 | C1 | 无文本回复桥、无 user_prompt 注入、无 form adapter |
| K2 | C2 | A1–A6 存在 |
| K3 | C3 | 构建、npm pack、真实 agent MCP/POST 闭环、切换回滚通过 |
| K4 | C4 | 仅使用允许命令，测试后旧 producer 已恢复 |
| K5 | C5 | 工作区无凭据，旧数据完整，未 push |
| K6 | C6 | 记录模型调用次数、切换前后状态与失败输出 |

## 命令

允许：
- pnpm install / pnpm run
- node / npx tsx
- curl
- git status / git log / git diff / git add / git commit
- ssh
- npm pack / npm install
- systemctl
- timeout

禁止：
- git push、改写远端、删除分支
- 回显凭据
- 删除旧 notifs 数据
- pkill -f、killall
- 发布解析模型最终文本的回复桥

## 预算

- 时间：12 小时
- 成本：真实模型调用最多 5 次
