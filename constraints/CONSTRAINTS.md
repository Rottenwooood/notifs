# 约束清单

项目：notifs v0.2.0 代码冗余清理

阶段：code-cleanup

## 约束

| 编号 | 约束 |
|---|---|
| C1 | 范围是删除零引用导出与重复实现：adapters 的 adapterKinds、飞书两个 adapter 各自复制的截断助手。不保留 registerAdapter，因为它已被 tests/delivery-retry.test.ts 使用；不改投递、渲染与重试语义。 |
| C2 | 产物为 packages/adapters/src/{index,render,feishu,feishu-app}.ts 的修改，以及本阶段约束清单与其生成稿。 |
| C3 | 验收标准是 pnpm typecheck、pnpm test、pnpm build 通过，隔离数据目录与端口下 CLI 能 init/start 并通过 /health，适配器注册表八种 kind 仍可解析。 |
| C4 | 允许 pnpm、node、curl、git 本地提交、timeout，以及 ~/.config/opencode/scripts 下的脚本；测试使用隔离目录与端口。 |
| C5 | 不 push、不 reset --hard、不改写历史、不删除用户正在编辑的 README.md、不使用 pkill -f 或 killall、不改全局 OpenCode 配置。 |
| C6 | 预算 40 分钟；不新增依赖；改动不超过 6 个文件。 |

## 范围

做：
- 删除零引用导出 adapterKinds
- 把飞书截断助手收敛到 render.ts

不做：
- 投递、渲染与重试语义变更
- 新增适配器或扩展点
- 用户 README 改动的提交

## 产物

| 编号 | 路径 | 形态 |
|---|---|---|
| A1 | packages/adapters/src/index.ts | 删除零引用导出 |
| A2 | packages/adapters/src/{render,feishu,feishu-app}.ts | 共享截断助手 |

## 验收

入口：bash /tmp/opencode/notifs-cleanup-accept.sh

| 检查项 | 来源 | 判定 |
|---|---|---|
| K1 | C1 | adapterKinds 不存在；registerAdapter 保留并被测试使用 |
| K2 | C2 | 四个源文件存在且无本地截断副本 |
| K3 | C3 | typecheck/test/build 通过，健康检查返回 ok |
| K4 | C4 | 仅在隔离目录与端口操作 |
| K5 | C5 | 工作区只含本次改动与用户 README 改动，未 push |
| K6 | C6 | 记录改动文件数与耗时 |

## 命令

允许：
- pnpm install / pnpm run
- node
- curl
- git status / git diff / git add / git commit
- timeout

禁止：
- git push、reset --hard、改写历史
- 回显凭据
- pkill -f、killall
- 删除用户正在编辑的 README.md
- 操作生产服务

## 预算

- 时间：40 分钟
- 成本：无模型调用
