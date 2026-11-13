# 约束清单

项目：notifs 代码包导出

阶段：bundle-export

## 约束

| 编号 | 约束 |
|---|---|
| C1 | 范围是把提交 HEAD 的被跟踪文本文件按依赖顺序导出为单个纯文本文件。不做源码修改、不加测试、不改接口，不把未跟踪的构建产物、锁文件、生成稿与历史机器日志写入产物。 |
| C2 | 产物为仓库内可复用的导出脚本 tools/export-codebase.mjs，以及仓库外的 /home/c6h4o2/exports/notifs-codebase-<提交>-<日期>.txt。 |
| C3 | 验收标准是往返还原：从产物逆解析出的每个文件与 git show 的字节完全相等；产物路径集合等于被跟踪文件减去排除清单；正文行数与头部声明一致；产物与工作区均无凭据。 |
| C4 | 允许 git ls-files、git show、git rev-parse、node、wc、sha256sum、secrets-audit.sh、git 本地提交、timeout。 |
| C5 | 不 push、不 reset --hard、不改写历史、不使用 pkill -f 或 killall、不回显凭据、不删除任何被跟踪文件、不改动用户正在运行的服务。 |
| C6 | 预算 30 分钟；导出脚本单次运行不超过 10 秒；产物不超过 400 KB；不产生长期运行进程。 |

## 范围

做：
- 按依赖方向排列全部被跟踪源码、配置、测试、文档
- 头部给出提交、文件数、行数、排除清单与行号索引
- 往返还原校验与密钥扫描

不做：
- 源码与接口变更
- 锁文件、构建产物、生成稿、历史机器日志
- 提交产物到仓库

## 产物

| 编号 | 路径 | 形态 |
|---|---|---|
| A1 | tools/export-codebase.mjs | 可复用的导出与自校验脚本 |
| A2 | /home/c6h4o2/exports/notifs-codebase-*.txt | 单文件代码包 |

## 验收

入口：bash /tmp/opencode/notifs-bundle-accept.sh

| 检查项 | 来源 | 判定 |
|---|---|---|
| K1 | C1 | 产物只含被跟踪文本文件，无构建产物与锁文件 |
| K2 | C2 | A1 与 A2 存在，A2 头部提交号等于 HEAD |
| K3 | C3 | 往返还原逐文件字节相等，路径集合与正文行数一致，无密钥命中 |
| K4 | C4 | 仅使用允许命令 |
| K5 | C5 | 工作区干净，未被跟踪文件未被删除，未 push |
| K6 | C6 | 记录运行耗时与产物体积 |

## 命令

允许：
- git ls-files / git show / git rev-parse / git status / git add / git commit
- node
- wc / sha256sum
- ~/.config/opencode/scripts/secrets-audit.sh
- timeout

禁止：
- git push、reset --hard、改写历史
- pkill -f、killall
- 回显凭据
- 删除被跟踪文件
- 操作正在运行的服务

## 预算

- 时间：30 分钟
- 成本：无模型调用
