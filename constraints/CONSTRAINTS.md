# 约束清单

项目：notifs 0.2 adapter 边界与入站链路

阶段：adapter-boundary

## 约束

| 编号 | 约束 |
|---|---|
| C1 | 范围只覆盖统一 adapter 契约、adapter 侧渲染与限频合流语义、OpenCode synthetic 注入、飞书人类入站 adapter；不改消息模型、订阅模型与权限模型。 |
| C2 | 产物为 contracts 的统一 adapter 接口、adapters 的统一 deliver 与 batch 渲染、OpenCode synthetic 调用、apps/feishu-inbound、构建入口、测试与文档。 |
| C3 | 入口为 pnpm typecheck、pnpm test、pnpm build、真实 OpenCode synthetic 注入验证、伪造飞书事件到中心再到订阅目标的端到端验证。 |
| C4 | 只允许 pnpm、node、tsx、curl、git、timeout；不修改用户正在使用的服务与全局 OpenCode 配置；不发送真实飞书消息。 |
| C5 | 不 push、不保留旧接口、不回显凭据、不删除旧用户数据、不使用 pkill/killall。 |
| C6 | 预算 4 小时；真实 OpenCode 验证最多 1 次模型调用；失败即停并记录输出。 |

## 范围

做：
- 所有 adapter 统一为 receive batch、返回 SendResult
- 人类渠道 adapter 自己从 content 渲染，一个限频窗口合并为一条消息
- OpenCode adapter 使用 synthetic message，delivery=steer，metadata 与 trust 标记
- 飞书入站 adapter 作为独立 bridge，用身份 token 发布 human.message

不做：
- 修改 type/content 契约
- 修改订阅与身份权限
- Discord/Windows 桌面实现
- 旧架构兼容

## 产物

| 编号 | 路径 | 形态 |
|---|---|---|
| A1 | packages/contracts/src/index.ts | DeliveryAdapter 与 DeliveryContext |
| A2 | packages/adapters/src/*.ts | 统一 deliver、batch 渲染、OpenCode synthetic、飞书入站 |
| A3 | apps/feishu-inbound/src/main.ts | 独立飞书事件 bridge |
| A4 | tools/build.mjs + package.json | feishu-inbound 构建与 bin |
| A5 | tests/*.test.ts | adapter 契约、渲染、OpenCode synthetic、飞书入站、限频合流回归 |
| A6 | docs/configuration.md + README.md | adapter 边界、入站、OpenCode 语义与新入口 |

## 验收

入口：pnpm typecheck && pnpm test && pnpm build

| 检查项 | 来源 | 判定 |
|---|---|---|
| K1 | C1 | 消息/订阅/权限模型未改 |
| K2 | C2 | A1–A6 存在 |
| K3 | C3 | 测试、构建、真实 OpenCode synthetic、飞书入站闭环通过 |
| K4 | C4 | 未修改用户服务/全局配置，未发真实飞书消息 |
| K5 | C5 | 工作区无凭据，无旧入口，未 push |
| K6 | C6 | 记录耗时与失败输出 |

## 命令

允许：
- pnpm install / pnpm run
- node / npx tsx
- curl
- git status / git log / git diff
- timeout

禁止：
- git push、改写远端、删除分支
- 修改用户正在使用的 notifs 服务或全局 OpenCode 配置
- 真实飞书消息、真实凭据回显
- pkill -f、killall

## 预算

- 时间：4 小时
- 成本：真实 OpenCode 验证最多 1 次模型调用
