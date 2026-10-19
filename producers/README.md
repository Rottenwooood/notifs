# producers

每个子目录是一个**独立的小程序**。它们之间没有共享代码；依赖自己声明，配置走
`producer.json`，产物就是按契约往 notifs 发一个 POST。

| 目录 | 做什么 | 依赖 |
|---|---|---|
| [`feishu-events/`](./feishu-events/) | 从飞书**收**消息（长连接）→ 回执 / `ask` | `@larksuiteoapi/node-sdk` |
| [`routine/`](./routine/) | 按时间表提醒（写作 / 回宿舍 / 上床 / 起床 / 洗澡） | 无 |

> **发往飞书不在这里。** 那是内置出口 `feishu`（群 webhook）和 `feishu-app`（应用机器人）。
> `feishu-events` 只负责把飞书的消息收回来。

## 用起来（两种方式）

**A. 让 notifs 托管（推荐）**

```sh
cp -r producers/routine ~/.local/share/notifs/producers/
cd ~/.local/share/notifs/producers/routine
# 有依赖的先装：npm install
notifs watcher sync
notifs watcher enable routine
notifs watcher logs routine
```

**B. 自己跑（不托管）**

```sh
cd producers/routine
npm start          # 需要下列环境变量
```

```sh
NOTIFY_BASE_URL=http://127.0.0.1:7710   # 中心地址
NOTIFY_TOKEN=<source token>             # 从 ~/.config/notifs/token 读，或 notifs source add 拿
NOTIFY_PRODUCER_ID=<可选>               # 托管时由中心注入；自己跑可省略（不发心跳）
NOTIFY_STATE_DIR=<可选>                 # 放游标；默认当前目录
NOTIFY_CONFIG='{"items":[...]}'         # 等于 producer.json 里的 config
```

## 改配置

配置在各自 `producer.json` 的 `config` 里。**改完要重启才生效**（托管程序不会因为文件变化自动重启）：

```sh
systemctl --user restart notifs
```

## 自己写一个

```sh
notifs watcher init my-watch            # 生成骨架（托管）
notifs watcher init my-poll --kind poller   # 或者不写代码，只写轮询配置
```

规则只有一条：**判断"什么算变化"是程序的事，中心只负责收、去重、路由、重试。**
契约见 `notifs contract`。
