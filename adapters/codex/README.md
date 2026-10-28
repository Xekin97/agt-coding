# Codex 分档模型适配器

提供任务路由、CLI 执行、原生子任务分派参数及执行回执。要求 Node.js 20.11+、Ruby（读取既有 YAML）；无需 npm 依赖。策略在 [models/codex-balanced.json](../../models/codex-balanced.json)，职责与授权在 [调度契约](../../core/model-routing.md)。

## 默认分工

| 工作 | 配置 | 边界 |
| --- | --- | --- |
| 产品、DBA、前后端架构决定 | GPT-6 Astra / high | 保持专业角色责任 |
| UI/UX、实施计划、测试设计、疑难调试、代码评审、独立验收 | GPT-6.1 Sol / high | 明确执行项再分派 |
| 普通编码、机械修改、单测编写、局部初修、明确文档整理 | GPT-6 Luna / medium | 有输入、范围和验收；高风险升级 |
| 文档压缩保留规则、语义复核 | GPT-6.1 Sol / high | `document-plan` / `document-review` |
| 归档搬移、hash、链接检查；test/lint/tsc/build 命令 | 工具 | `archive-execution` / `test-execution`，不启动模型 |
| 事务性守门检查 | GPT-6.1 Sol / medium + 工具 | 不替专业角色验收 |

中央策略 `codex-balanced@1.2.0` 新增文档计划、文档复核和归档执行类别，保留 1.1.0 的模型绑定。绑定资料的核验日期仍为 2026-10-05；每次模型分派另做实时能力预检。复杂 AGT 压缩通常按“Sol 确定保留项 → Luna 整理 → 工具静态检查 → Sol 语义复核”完成；明确的小整理不强制四轮。`agt-quick compact` 只登记、核验已完成的整理，不是聊天上下文压缩或自动改文档命令。

解析顺序：角色/阶段合法性 → 任务类别 → 风险下限 → 实现失败升级 → 模型能力检查。high 至少 strong，critical 为 frontier；每两个有证据的实现失败提升一档，8 次停止。例如 high 编码在第 2 次实现失败后即升 frontier。环境失败、取消不计入升级；不自动重试。

## 查看能力与采用锁

从基座根目录运行；以下 `../project` 是产品示例。

```bash
node adapters/codex/agt-models.mjs catalog
node adapters/codex/agt-models.mjs resolve \
  --stage implementation --role backend-implementer/base --task unit-tests
node adapters/codex/agt-models.mjs resolve \
  --stage control --role gatekeeper --task archive-execution
```

发现能力不创建推理 turn。采用后生成新锁，输出目录须存在，拒绝覆盖旧锁：

```bash
node adapters/codex/agt-models.mjs lock \
  --output ../project/.planning/agt/model-routing-v2.lock.json \
  --approval DEC-model-routing-002
```

锁保存政策、hash、CLI 版本、模型能力与批准来源；不更改产品 Profile 或全局 Codex 配置。`approval` 是可追溯的批准引用，不能替代授权。已有 1.0.0 锁仍保留 5.6 模型绑定，也不自动得到新增任务类别；采用新策略须新建锁并更新产品引用，旧锁保留。

## 任务包与执行

按 [模板](../../templates/model-task.json) 填写稳定 `task_id`、明确 `objective`、输入路径、精确 `write_scope`、可观察 `acceptance`、`risk` 与具体 `risk_reason`。只读审查使用 `"read_only": true, "write_scope": []`。子任务按共同输入和验收组织，不为每次工具调用单独派发。输入相对产品 Git/worktree 根目录；传入子目录会统一归一到根目录。任务定义、范围、上下文或类别变化须使用新 ID，不能借复用 ID 覆盖旧尝试。

预览不启动推理、不建立尝试记录：

```bash
node adapters/codex/agt-models.mjs launch \
  --project ../project --lock ../project/.planning/agt/model-routing-v2.lock.json \
  --packet ../project/.planning/current-task.json --task unit-tests
```

阶段任务从 state/registry 验证唯一活动角色，不接受任意角色覆盖。Quick 不依赖活动里程碑角色，使用已有 active Q 任务的分支、计划和批准范围：

```bash
node adapters/codex/agt-models.mjs dispatch \
  --project ../project --lock ../project/.planning/agt/model-routing-v2.lock.json \
  --packet ../project/.planning/current-task.json --task documentation \
  --quick Q001-tidy-notes --role frontend-implementer/base
```

`dispatch` 做实时能力预检、保留一次待执行尝试，返回 `spawn` 对象。协调者必须将其中 `model`、`reasoning_effort`、`fork_turns: none`、任务名和 message 传给宿主原生子代理工具，等待结果，再登记真实 runtime ID。输出参数不代表代理已启动。若尚未启动、没有 runtime ID，用有证据的 `cancelled` 回执关闭本次分派尝试；已启动后的环境故障使用真实 ID 的 `environment_failure`。这不等于取消原 Quick/产品任务，也不能丢弃记录后假称成功。分派后的执行者只做限定任务，不递归派发；Quick 子任务引用责任角色定义，不启动或迁移里程碑角色。

若使用 CLI，改用 `launch` 和相同参数，加 `--run`。CLI 参数数组显式指定模型与 effort，任务包经 stdin 传入，附 `--json` 采集事件；只读任务额外加 `--sandbox read-only`。不会热切换已打开的 App 主会话，也不会放宽权限。纯工具类别只返回执行指引，不查模型清单、不占用模型尝试。

每项记录放在 `.planning/agt/model-runs/<task_id>.json`。稳定 ID 只允许字母、数字、下划线和短横线，最多 96 字符。状态查看：

```bash
node adapters/codex/agt-models.mjs status --project ../project --task-id TASK-001
```

## 回执、失败与运行观测

协调者依据产物和验收证据判定结果。回执示例（使用真实文件、尝试号和运行 ID）：

```json
{
  "attempt": 1,
  "outcome": "pass",
  "summary": "已核对保留约束、引用和未解决事项；证据见审查记录",
  "evidence": [".planning/evidence/TASK-001-review.md"],
  "runtime_id": "真实子会话 ID",
  "runtime_log": "/实际位置/对应子会话的运行时事件.jsonl"
}
```

`runtime_log` 可选；只有取得真实日志才提供，允许显式指定项目外的本地 Codex 运行日志。必须匹配同一 runtime ID。原生非取消回执要求真实 ID；CLI 通常从执行事件取得 ID。登记：

```bash
node adapters/codex/agt-models.mjs record --project ../project \
  --task-id TASK-001 --receipt ../project/.planning/receipt.json
```

结果为 `pass`、`implementation_failure`、`environment_failure` 或 `cancelled`；都需摘要与项目内证据文件。工具将原始证据按 hash 保存快照，后续修改源文件不会抹掉失败证据。CLI 退出码 0 只进入待复核状态，非零须分类；进程未完成、已知模型/effort 不匹配不能通过。待结案尝试不能重复分派，已完成任务不能复用。新尝试自动携带历史失败与证据指针，并从记录累计升级，不信任任务包里自填的 `prior_attempts`。`--failures` 仅用于 `resolve` 或旧格式只读预览，不能覆盖正式任务历史。

运行时日志有 model/effort 才记观测值；只有 usage 时不能据此推断模型。补充日志不能擦除已有不匹配观测。`actual_model: not_observed`、usage 为 null 表示未观测，不等于已验证符合路由。模型观测表示运行时配置，不是提供方或账单认证；usage 仅统计该日志对应会话，不包含未观测的协调者、其他子会话和返工。回执不能用手填 actual_model/usage 冒充运行证据。

CLI 的事件和 stderr 保存在同目录，文件权限 0600；可能包含任务内容，默认不向终端重复输出全文。任务记录、日志和证据沿产品的归档规则管理，不把它们当成默认全文上下文。`inputs` 只是定位入口，不是访问白名单；原生执行的只读/写入范围由宿主权限和任务契约约束，适配器不拦截每次读写。记录是协调工具，不是独立的防篡改审计平台。

## 更新与验证

模型 `launch`（含预览）、`dispatch` 和 `check-updates` 实时查询 Codex 版本和分页 model/list，核对策略差异、模型/effort 移除及 upgrade 提示。旧锁不静默改写、不可用不自动回退：

```bash
node adapters/codex/agt-models.mjs check-updates \
  --lock ../project/.planning/agt/model-routing-v2.lock.json
node --test tests/model-routing.test.mjs tests/model-execution.test.mjs tests/model-dispatch.test.mjs
./validators/validate-profile.sh profiles/consumer-ai-web/PROFILE.yaml
```

`check-updates` 能力失效退出码 2；协议/参数错误退出码 1。`--inventory` 只供 resolve/lock/check-updates 离线评审，launch/dispatch 必须实时预检。`--codex` 可指定安装位置，回归测试使用本地替身，不证明真实模型质量或节省比例。策略可显式使用 `ultra`，但必须经当前清单确认支持；默认仍是 medium/high。

新绑定先核实官方能力与成本，再对同组代表任务比较质量、返工和总消耗，按用户授权采用新版本锁。当前没有后台守护进程、账单预算熔断或全局 token 上限；不能用 API 标价推算 Codex 订阅扣费。

## 官方依据

2026-10-05 核验的模型资料及宿主能力说明：

- [Codex 子代理](https://learn.chatgpt.com/docs/agent-configuration/subagents)：显式 model/effort 与最小上下文；未指定时可能继承。
- [Codex App Server](https://learn.chatgpt.com/docs/app-server#list-models-modellist)：模型、effort、分页和 upgrade 元数据。
- [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)、[GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)、[GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)：API 能力资料不能代替 Codex 运行时可用性检查。

分工是 AGT 工程策略，不是模型结果保证。能力清单也不证明一次实际调用已经成功。
