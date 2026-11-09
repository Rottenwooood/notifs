# 使用入口

团队通信使用 [v2 指南](messaging.md)，架构见 [设计概览](design/notifs-v2.md) 或 [HTML](design/notifs-v2.html)。本文只说明运行方式与保留的 v1 通知入口。

## 运行

```sh
npm install -g notifs
notifs init
notifs start
```

仓库开发：安装依赖、构建后运行 `node dist/cli.mjs`；`bin/nh` 是开发快捷入口。默认数据目录为 `~/.local/share/notifs`，配置目录为 `~/.config/notifs`，HTTP 为 `127.0.0.1:7710`。

`NOTIFY_DATA_DIR`、`NOTIFY_DB`、`NOTIFS_CONFIG_DIR`、`NOTIFY_HOST`、`NOTIFY_PORT` 可覆盖默认值；`NOTIFY_BASE_URL` 指向远端中心。配置文件和旧路径兼容见 `tools/run.sh`。常驻部署见 [部署文件](../deploy/README.md)，远端访问见 [SSH 隧道](remote.md)。

## v1 通知入口

```sh
notifs channel add desktop --kind local --config '{}'
notifs rule add --name all --when '{}' --actions '[{"channel":"desktop"}]'
notifs notify 'hello'
notifs events
notifs deliveries
```

v1 请求为 `type + text`，可加 `dedup_key`。渠道和 rule 管理是本机 CLI 操作；这些规则不自动变为 v2 subscription。v2 使用 `type + content`、独立的接收目标、批量与确认。

所有命令以 `notifs help` 为准。已有 [监控程序协议](producer-protocol.md)、[渠道配置](channels.md) 和 [示例程序](../producers/README.md) 继续可用。托管程序使用 `watcher init/check/try/enable/logs`；凭据由 `secret set` 保存，在程序清单中仅声明名称。

## 边界

- v1 支持通知发送与 Feishu 引用回复的 ask；v2 不引入回复关联字段。
- v1 没有规则限频、静默时段；v2 的批量与限频配置在接收目标上。
- `at` 是 v1 事件时间，不是定时执行。周期事件由外部程序产生。
- 当前没有 Web UI、内置 LLM 生成器或 `author` / `llm` 命令。
- 投递可能重试；平台接受不等于人已读，运行时接管不等于业务完成。
- 备份用 `notifs backup`；加密凭据需要同时保留主密钥。

阶段验收流程与记录见 [validation](validation/README.md)。
