# 约束清单

项目：notifs v0.2.0 文档时效性收口

阶段：docs-v0.2.0-alignment

## 约束

| 编号 | 约束 |
|---|---|
| C1 | 范围是让文档陈述与 0.2.0 代码及已完成状态一致：MCP 配置形状、保留清理能力、发布完成状态、生产拓扑、部署模板、构建提示文本。不做功能新增、不改投递与路由语义、不改测试断言、不删历史验收证据、不删本地发布包、不 push。 |
| C2 | 产物为 README、docs/mcp.md、docs/release-plan.md、docs/boundaries.md、docs/configuration.md、docs/validation/stage-8.md 的修正，deploy 说明与 unit 模板的更新，CHANGELOG 的未发布段，tools/build.mjs 提示行，以及本阶段约束清单和其生成稿。 |
| C3 | 验收标准是文档陈述与代码逐条可核对：按修正后的 MCP 配置能被 OpenCode 2.x 识别并连通、按 README 所述保留清理真实执行、发布路线不再把已完成项写成未完成；同时 pnpm typecheck、pnpm test、pnpm build 通过，约束清单渲染校验退出 0。 |
| C4 | 允许 pnpm、node、curl、opencode run、opencode mcp list、git 本地提交、timeout，以及 ~/.config/opencode/scripts 下的脚本；测试使用隔离的数据目录、配置目录和端口。 |
| C5 | 不 push、不 reset --hard、不改写历史、不使用 pkill -f 或 killall、不回显凭据、不修改全局 OpenCode 配置、不操作生产 relay、不删除 docs/validation 下的历史结果文件。 |
| C6 | 预算 60 分钟；真实模型调用最多 2 次；文档改动控制在 12 个文件以内；不新增长期运行的进程。 |

## 范围

做：
- 修正与代码矛盾的文档陈述
- 统一 MCP 配置示例为 OpenCode 2.x 的扁平 mcp 映射
- 更新发布状态、生产拓扑与部署模板
- 重写本阶段约束清单并重新生成渲染稿

不做：
- 功能与接口变更
- 测试断言变更
- 删除历史验收记录
- 生产环境操作

## 产物

| 编号 | 路径 | 形态 |
|---|---|---|
| A1 | docs/mcp.md | MCP 配置示例与工具说明 |
| A2 | README.md | 交付边界中的保留清理陈述 |
| A3 | docs/release-plan.md | 当前基线与下一步入口 |
| A4 | docs/boundaries.md + docs/validation/stage-8.md | 生产拓扑与观察窗口状态 |
| A5 | deploy/README.md + deploy/notifs.service | 部署入口与 systemd 模板 |
| A6 | constraints/constraints.yaml | 本阶段六项约束 |

## 验收

入口：bash /tmp/opencode/notifs-doc-accept.sh

| 检查项 | 来源 | 判定 |
|---|---|---|
| K1 | C1 | 文档改动只涉及时效性陈述，无接口语义变化 |
| K2 | C2 | A1–A6 全部存在且内容与代码一致 |
| K3 | C3 | MCP 配置被 OpenCode 识别并连通；保留清理真实删除已接管消息；构建与测试通过 |
| K4 | C4 | 仅在隔离目录与端口操作，未触碰生产服务 |
| K5 | C5 | 无凭据入库、历史结果文件完整、未 push |
| K6 | C6 | 记录模型调用次数与耗时 |

## 命令

允许：
- pnpm install / pnpm run
- node / npx tsx
- curl
- opencode run / opencode mcp list
- git status / git diff / git add / git commit
- timeout

禁止：
- git push、reset --hard、改写历史
- 回显凭据
- pkill -f、killall
- 修改全局 OpenCode 配置
- 删除 docs/validation 下的历史结果文件

## 预算

- 时间：60 分钟
- 成本：真实模型调用最多 2 次
