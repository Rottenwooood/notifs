# routine（作息提醒）

到点就发一条通知。时间表写在 `producer.json` 的 `config.items` 里。

| 时间 | 提醒 |
|---|---|
| 23:00 | 开始写知乎每日总结 |
| 23:30 | 回宿舍 |
| 00:00 | 上床，不带手机 |
| 08:00 | 起床 |
| 周六 08:30 | 洗澡 |

## 改时间表

编辑 `producer.json` 的 `config.items`。**改完必须重启一次中心才生效**：

```sh
systemctl --user restart notify-hub
```

（监护器只在启动时对齐；文件变化不会重启一个**已经在跑**的程序。）


```jsonc
{
  "id": "daily-summary",     // 唯一标识，改了会重发一次（见下）
  "at": "23:00",             // HH:MM，按 timezone
  "title": "开始写知乎每日总结",
  "text": "打开文档，先写今天做了什么——5 行就够。",
  "days": [6],               // 可选，0=周日…6=周六；不写 = 每天
  "severity": "warn"         // 可选，info（默认）/ warn / critical
}
```

## 行为

- **每天每条只响一次**：`dedup_key = routine:<id>:<日期>`。发出去之后才记账，发失败会在宽限期内重试。
- **迟到宽限 30 分钟**（`graceMinutes`）：到点后 30 分钟内仍会补发；超过就当今天错过了。
  这是为了**避免开机时一次性弹出今天所有错过的提醒**。
- 时间按 `timezone`（默认 `Asia/Shanghai`）算，不吃进程的本地时区。

## 它会以什么方式坏，你多久能发现

| 坏法 | 表现 |
|---|---|
| **电脑关机 / 休眠** | **整条提醒不会发出**。这不是 bug，是它的本质：消息由这台机器发出。宽限期内的补发也依赖它醒着 |
| 电脑在 23:00 时是睡着的、23:20 才醒 | 会补发（在 30 分钟宽限内） |
| 电脑 23:00 关到第二天早上 | 23:00 那条**不补发**（超宽限），当晚的作息已经没意义 |
| 服务没起（systemd） | 所有提醒都静默；`systemctl --user status notify-hub` 看 |
| 这个程序崩了 | 中心按退避重启；`nh watcher list` 里 restarts 会涨 |

**所以**：8:00 起床这条，如果你的电脑晚上是关着的，它**不会响**。
手机自带的重复闹钟在这件事上比它可靠——把它当"电脑开着时的加固"，不是唯一手段。

## 自检

```sh
nh watcher list | grep routine      # status 应为 running
nh watcher logs routine --tail 20
# 想立刻验证链路（会真发一条到飞书）：
nh emit --token "$(cat data/producers/routine/token)" --type routine.test --text "测试"
```
