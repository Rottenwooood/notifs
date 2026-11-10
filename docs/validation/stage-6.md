# 阶段 6：OpenCode 回复桥与真实 agent 闭环

实现范围：新增 OpenCode 宿主侧回复桥，把已完成的 assistant 文本以 agent 身份发布回 notifs；用同一个飞书 bot 验证“人 → 入站 bridge → notifs 0.2 → OpenCode → 回复桥 → 同一个 bot → 同一个人”。

## 验证入口

```sh
pnpm typecheck && pnpm test && pnpm build
```

结果：类型检查通过；9 个测试文件、57 项通过；构建生成 `dist/opencode-host.mjs`，bin 为 `notifs-opencode-host`。

## 真实闭环

测试时间：2026-11-10T12:30:11Z 至 2026-11-10T12:35:21Z。

1. 人在飞书群 `oc_5a2f9f2c3164f26dae8750b8ae8c9632` 引用回复测试消息，内容 `AGENT_LOOP_20261110`。
2. 本地新 bridge 用同一个飞书应用的长连接收到事件，日志出现 `ws client ready`，发布入站消息：

```text
feishu inbound -> notifs d559a92e-42da-4aaf-850f-72105a8d6adf recipients=agent-opencode
```

入站消息检查：

```json
{
  "id": "d559a92e-42da-4aaf-850f-72105a8d6adf",
  "source": "human",
  "type": "human.message",
  "content": {
    "text": "AGENT_LOOP_20261110",
    "chat_id": "oc_5a2f9f2c3164f26dae8750b8ae8c9632",
    "message_id": "om_x100b6004abe59ca0c0a0942be64a383",
    "sender_type": "user"
  },
  "deliveries": [{"endpoint": "agent-opencode", "state": "received"}]
}
```

3. notifs 0.2 将消息写入真实 OpenCode 会话 `ses_e3a93518fffedMgjSDGswGtAm4`，模型为 `opencode-go/deepseek-v4.1-flash`。会话中 synthetic 消息 `msg_28350b2ff8fdb896b95ac87158` 的 `type=synthetic`，不是用户提示词。
4. 模型第一轮没有走 notifs，而是在 OpenCode 内生成了一张澄清表单并等待。为了让闭环继续，表单被直接回答为“这只是循环触发，无任务”；模型随后产出最终文本 `msg_1c5748700001C1D195RMeuSrG7`。这说明问题在 agent 行为约束，不在 notifs 缺少提问通道。
5. 回复桥捕获最终文本并发布：

```text
opencode reply -> notifs 4a603484-56fa-420a-b614-41ac6ef1c167 recipients=feishu-human
```

回复消息检查：

```json
{
  "id": "4a603484-56fa-420a-b614-41ac6ef1c167",
  "source": "agent",
  "type": "reply",
  "content": {
    "text": "确认收到：本次为循环触发，无任务内容，未开工。",
    "opencode": {
      "session_id": "ses_e3a93518fffedMgjSDGswGtAm4",
      "message_id": "msg_1c5748700001C1D195RMeuSrG7",
      "model": "opencode-go/deepseek-v4.1-flash"
    }
  },
  "deliveries": [{"endpoint": "feishu-human", "state": "received"}]
}
```

6. `feishu-app` 用同一个飞书应用把回复发回原群，飞书 API 接受，投递状态 `received`。

## 结论与边界

- 同一个 bot 的双向链路已用真实飞书事件和真实模型跑通；入站、中心路由、synthetic 注入、模型回复、回复桥、出站均有消息 ID 和投递状态。
- 回复桥只发布最终文本，不发布 reasoning 和工具过程。
- 本次模型先要求澄清时用了 OpenCode 的本地 form，而不是 notifs。notifs 已有向人发送问题和接收回复的通道；正确修法是在具体 agent 的 prompt 或工具权限里限制“面向人的输出必须走 notifs，不得停在本地 form/question”，不需要新增 form/permission adapter。
- 测试结束后旧 `feishu-events` 已恢复，PID `435411`，状态 `running`；旧 notifs 服务 `active`。本地新栈和临时凭据已停止/删除。
- 本次真实模型调用 2 次（首次回答与表单后最终回答），未超过阶段预算。

## agent profile 补充验证

2026-11-10T14:00Z 在临时项目 `/tmp/opencode/notifs-profile-test` 加载 `integrations/opencode` 的 `notifs` agent：

- OpenCode `/api/agent?location[directory]=...` 返回 `notifs`，system prompt 已加载，权限列表包含 `question=deny`、`form=deny`。
- 直接向该 profile 的会话发送“需要在 A 和 B 之间选择”的测试提示，模型最终文本为“请选择：A 还是 B？”，没有生成 form。
- 这说明问题确实在 agent profile，不在 notifs 通道；回复桥只需校验会话绑定 `OPENCODE_AGENT=notifs`。
- 本次为第 3 次模型调用，仍在阶段预算内。
