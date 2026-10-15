# pr-replies

监控一个 GitHub PR 的新回复，出现就发一条通知（内容就是那条回复本身）。

- 类型：managed（中心托管：拉起、心跳、崩溃重启、日志）
- 配置在 `producer.json` 的 `config`：`repo` / `pr` 换成你要盯的 PR 即可
- 默认**什么都上报**（含机器人的自动报告、`/run` 命令、你自己的评论）
- 状态（游标 + ETag）在 `NOTIFY_STATE_DIR`，重启能续上

## 它上报什么

| 情况 | 上报 |
|---|---|
| 会话评论有新的一条 | `github.pr.reply`（text = 评论正文） |
| 代码行内评论有新的一条 | `github.pr.reply`（`data.kind=review_comment`） |
| 正式 review（Approve / Request changes） | `github.pr.reply`（`data.kind=review`，`data.review_state`） |
| 机器人评论（`github-actions[bot]` 的自动报告等） | 上报（默认不过滤） |
| `/run`、`/cheat` 这类命令 | 上报（默认不过滤） |
| 你自己发的 | 上报（默认不过滤） |
| 去掉标记后没有正文的评论 | **不上报** |
| 首次启动 | 一条 `github.pr.monitor.started`（确认活着 + 建基线） |

## 想收紧（可选）

三个开关都放在 `producer.json` 的 `config` 里，默认关：

```jsonc
{
  "ignoreBots": true,                     // 丢掉 *[bot] 的自动报告
  "dropCommands": true,                   // 丢掉 /run、/cheat 这类纯命令
  "ignoreAuthors": ["LuyuZhou24"]         // 丢掉指定的人（你自己 / 队友）
}
```

理由：这个 PR 的 31 条评论里 11 条是 `github-actions[bot]` 刷的。全开过滤只剩"人话"，
但也会漏掉**机器人跑出来的 trial results**——那里面往往正是你要的结果。所以默认全放行。

## 它会以什么方式坏，你多久能发现

| 坏法 | 你能发现吗 |
|---|---|
| **GitHub 匿名限流**（60 次/小时） | 会收到 `degraded` 心跳 → 中心记着；`nh watcher logs pr-replies` 里能看到"GitHub 限流"。缓解：给 `GITHUB_TOKEN` |
| API 改版 / 字段改名 | 同上：`degraded` + 日志报错，但**通知不会来** |
| **这个仓库的评论协议变了**（比如改用 inline review） | 不会报错——只是某类回复不再触发。表现为"该来的通知没来"，**这是最危险的一种** |
| 有人改了 `ignoreAuthors` 之外的名字发评论 | 正常上报 |
| 进程崩了 | 中心按退避重启；`nh watcher list` 里能看到 restarts 增加 |

**唯一可靠的自检**：`nh watcher list` 看状态是不是 `running`、`lastError` 是不是空。
"沉默"不等于"健康"——这个程序只有"没回复"时才沉默。

## 提高额度（可选）

匿名 60 次/小时，本程序用 ETag（内容没变返回 304，**不计额度**），所以正常够用。
想更稳就给它一个 GitHub token：

```sh
# 把 token 写进中心的 env（600），中心会注入给声明了它的程序
echo 'GITHUB_TOKEN=ghp_xxx' >> ~/.config/notify-hub/env
# 然后在 producer.json 的 credentials 里加上 "GITHUB_TOKEN"，重启本程序
```

## 常用命令

```sh
nh watcher check  pr-replies     # 静态校验
nh watcher try    pr-replies     # 试运行：只打印"将会上报什么"，真调 GitHub
nh watcher enable pr-replies     # 上线
nh watcher logs   pr-replies     # 看它的日志
nh watcher disable pr-replies    # 停
```
