# 阶段验收

每阶段保存 Git 提交，再用实际外部客户端操作构建后的服务；发现缺陷时单独提交修复并外部复验。阶段结束报告提交号、文件级变更和目录树。

固定验收客户端：OpenCode Go `opencode-go/deepseek-v4.1-flash`。不能因不可用而静默换模型。

```sh
opencode run --standalone --auto --agent Full-Auto \
  --model opencode-go/deepseek-v4.1-flash --format json \
  --title 'notifs 阶段外部验收' '<当前阶段的验收任务>'
```

在私有临时目录中准备独立的配置、数据目录、端口、CLI 路径及项目 OpenCode 配置；不改全局配置，不使用用户的真实接收渠道。真实入口包括：

- CLI / HTTP / IPC：创建身份与订阅、发送、主动推送、交付状态、定向、幂等冲突、管理隔离。
- 运行恢复：真实服务 SIGKILL、保留数据库和 socket、重启后继续投递。
- MCP：在 OpenCode 注册当前 MCP server，通过模型实际调用 send / set_endpoint / set_subscription / inspect；CLI 作为独立观察入口核对状态。
- 文档：从 README、help 和链接说明完成操作，不靠读取源码猜测接口。

模型不得导入内核代码、读取数据库或运行测试套件来代替外部验收。`tests/` 仅用于辅助回归。

保存 provider/model、OpenCode 会话 ID、对应提交、实际命令或 MCP 工具名、关键结果、发现的缺陷和复验。提交证据前检查不含 token；完整原始会话留在本机私有目录，不能直接提交。未完成的步骤标为未验证，不写“全部通过”。

## 当前实现

- [阶段 6：OpenCode 回复桥与真实 agent 闭环](stage-6.md)
- [阶段 5：统一 adapter 边界、飞书入站与 agent synthetic 注入](stage-5.md)
- [阶段 4：通用角色与中心主动交付](stage-4.md)

## 历史验收记录

阶段 1/2/3 记录当时的实现与缺陷，不代表保留其中的旧入口。当前配置只见 [配置手册](../configuration.md)。

- [阶段 1：基础链路及外部缺陷修复](stage-1.md)
- [阶段 2：清理、文档与真实 MCP 验收](stage-2.md)

- [阶段 3：旧架构清理及当时的配置验收](stage-3.md)
