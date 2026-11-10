# 约束清单

项目：notifs 0.2 真实 agent 闭环

阶段：real-agent-loop

## 约束

| 编号 | 约束 |
|---|---|
| C1 | 范围只覆盖 OpenCode 宿主侧回复桥、构建入口、测试与文档，以及用同一个飞书 bot 完成一次真实的人到 agent 再到人的闭环；不改消息模型、订阅模型、权限模型和既有 adapter 语义。 |
| C2 | 产物为 apps/opencode-host 的回复桥、tests/opencode-host.test.ts、tools/build.mjs 与 package.json 的构建入口、docs/configuration.md 的宿主说明、docs/validation/stage-6.md 的验证记录。 |
| C3 | 入口为 pnpm typecheck、pnpm test、pnpm build，以及真实飞书闭环：人在飞书发送消息，同一个 bot 的长连接入站，notifs 0.2 推送到真实 OpenCode 会话，宿主桥把模型回复以 agent 身份发回 notifs，再由同一个 bot 出站到同一会话。 |
| C4 | 只允许 pnpm、node、tsx、curl、git、timeout、ssh；真实闭环期间允许临时停用 relay 上的 feishu-events 入站 producer，允许发送本次测试所需的真实飞书消息。 |
| C5 | 不 push、不修改全局 OpenCode 配置、不回显凭据、不删除旧 notifs 数据、不使用 pkill/killall、不更换飞书应用、不在测试结束后保留临时凭据文件。 |
| C6 | 预算 4 小时；真实模型调用最多 3 次；闭环失败立即恢复旧 producer 并记录完整失败输出。 |

## 范围

做：
- OpenCode 宿主侧捕获已完成 assistant 回复并发布 agent reply
- 本地 notifs 0.2 与 Feishu bridge 的同 bot 双向验证
- 真实模型 opencode-go/deepseek-v4.1-flash 的闭环调用

不做：
- 修改消息/订阅/权限契约
- 修改全局 OpenCode 配置
- 永久切换生产 notifs
- Discord/Windows 桌面

## 产物

| 编号 | 路径 | 形态 |
|---|---|---|
| A1 | apps/opencode-host/src/main.ts | OpenCode 回复桥，轮询会话并发布 reply |
| A2 | tests/opencode-host.test.ts | 回复提取、去重、发布与错误处理回归 |
| A3 | tools/build.mjs + package.json | opencode-host 构建入口与 bin |
| A4 | docs/configuration.md | OpenCode 宿主回复桥配置说明 |
| A5 | docs/validation/stage-6.md | 真实验证命令、输出与结论 |

## 验收

入口：pnpm typecheck && pnpm test && pnpm build

| 检查项 | 来源 | 判定 |
|---|---|---|
| K1 | C1 | 消息/订阅/权限模型与既有 adapter 语义未改 |
| K2 | C2 | A1–A5 存在 |
| K3 | C3 | 构建通过且真实飞书闭环有消息 ID、投递状态与模型回复证据 |
| K4 | C4 | 仅使用允许命令，测试后旧 producer 已恢复 |
| K5 | C5 | 工作区无凭据，无全局配置改动，未 push |
| K6 | C6 | 记录耗时、模型调用次数与失败输出 |

## 命令

允许：
- pnpm install / pnpm run
- node / npx tsx
- curl
- git status / git log / git diff
- ssh
- timeout

禁止：
- git push、改写远端、删除分支
- 修改全局 OpenCode 配置
- 回显凭据
- 删除旧 notifs 数据
- pkill -f、killall

## 预算

- 时间：4 小时
- 成本：真实模型调用最多 3 次
