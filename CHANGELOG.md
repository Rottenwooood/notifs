# Changelog

## Unreleased

### Fixed

- 文档与实现对齐：MCP 配置示例改为 OpenCode 2.x 的扁平 `mcp` 映射并补 token 注入；README 更正保留清理能力；发布路线更新完成状态、生产拓扑与下一步入口。
- `deploy/notifs.service` 标注为 root 模板并指向实际配置目录；部署说明区分用户级与系统级安装。
- 构建提示列出 `kernel-worker` 产物。

## 0.2.0

### Added

- 统一 adapter 批次交付契约；人类渠道在 adapter 边缘渲染。
- 飞书应用长连接入站，支持相关消息过滤和 HTTP 回调回退。
- 飞书 `feishu-app` 出站、OpenCode synthetic 输入。
- agent 接入契约：中心→agent 使用宿主非 user_prompt 输入；agent→中心使用 MCP `send` 或 HTTP POST。
- 消息保留清理、在线备份、systemd 用户服务生成。
- 飞书 bridge 单实例锁。
- 发布路线、agent 接入和阶段验收文档。

### Changed

- 版本从 `0.2.0-alpha.1` 升到 `0.2.0`。
- 删除通过解析模型最终文本发消息的回复桥；agent 必须显式发送。

### Not included

- Discord、Windows 桌面、HA、多节点、Web UI、旧 notifs 历史导入。
