# Profile 契约

每个可选择 Profile 位于 `profiles/<profile-id>/PROFILE.yaml`。Profile 组合仓库中已经存在的角色与 Skill，定义阶段、必需产物和默认倾向；它不能复制产品专属需求，也不能把建议写成用户已确认决策。

## 顶层字段

| 字段 | 含义 |
|---|---|
| `schema_version` | Profile 文件结构版本，当前为 `1` |
| `id` / `version` | 稳定 Profile ID 与语义化版本；目录名必须等于 `id` |
| `status` | `available`、`draft` 或 `deprecated`；初始化只能推荐 `available` |
| `recommendation` | 供初始化角色比较的匹配、不匹配、默认倾向和取舍 |
| `decision_policy` | 说明默认值的决策等级和必须由用户确认的事项 |
| `roles` | Profile 使用的角色、Prompt 来源、Skill 和语义名称前缀 |
| `workflow` | 初始/终止阶段、活动角色、必需产物、审批和允许迁移 |
| `ai_delivery_contract` | AI 产品跨产品、架构、实现和验证阶段的最低要求 |
| `delivery_defaults` | 可被专业角色评估的默认倾向，不能自动视为 `CONFIRMED` |

`required_artifacts` 中的 `{milestone}` 在产品仓库初始化和阶段迁移时替换为当前里程碑，例如 `M001`。所有产物路径都相对于产品仓库根目录。

## 角色和阶段规则

- `kind: specialist` 的角色必须属于至少一个工作阶段；`kind: control` 的守门角色通过 `workflow.control_role` 声明。
- `active_role` 必须来自当前阶段的 `allowed_roles`，控制角色执行显式门禁操作时除外。
- `completion_policy: all-roles` 表示阶段内所有列出的专业角色都必须提交各自产物和交接单。
- `transitions` 同时包含正常前进和按责任阶段返回的单步迁移；任何迁移仍需要遵守用户显式确认规则。
- `milestone-complete` 是终止阶段，不激活专业角色。

## 校验

运行：

```bash
./validators/validate-profile.sh profiles/consumer-ai-web/PROFILE.yaml
```

校验器检查 schema、ID/version、角色与 Skill 文件、语义名称前缀、阶段引用、迁移目标和产品产物路径。只有通过校验且 `status: available` 的 Profile 才能由 `$agt-start-project` 推荐。
