# Codex 分档模型适配器

这是可运行的路由器和CLI启动器，不是仅供阅读的推荐表。要求Node.js 20.11+；启动项目任务还需要Ruby（读取既有YAML状态/注册表），无需安装npm依赖。主策略在 [models/codex-balanced.json](../../models/codex-balanced.json)，规则在 [core/model-routing.md](../../core/model-routing.md)。

## 默认编排

| 阶段 / 任务 | 默认配置 | 升级原则 |
| --- | --- | --- |
| 初始化、需求/产品策划 | GPT-6 Astra / high | 不默认max |
| DBA、前后端架构 | GPT-6 Astra / high | 不用低成本执行者重新决定架构 |
| UI/UX设计 | GPT-6.1 Sol / high | 全新复杂交互/高风险判定升Astra |
| 实施主角色、Plan、测试设计 | GPT-6.1 Sol / high | 明确任务包后再交执行档 |
| 普通编码、机械修改、单测生成、局部初修 | GPT-6 Luna / medium | 明确写入范围/输入/验收；高风险直接Sol |
| test/lint/tsc/build执行 | 工具，无模型 | 失败解释/覆盖判断另分配任务 |
| 疑难Bug、Code Review、独立验收 | GPT-6.1 Sol / high | critical升Astra |
| 普通文档整理 | GPT-6 Luna / medium | 新需求、架构结论、验收判断不属于整理 |
| 守门器事务性检查 | GPT-6.1 Sol / medium + 校验脚本 | 不替专业角色复写方案或进行语义验收 |

当前中央策略为`codex-balanced` 1.1.0（2026-10-05核验）。`balanced`和`strong`共用GPT-6.1 Sol，分别使用medium和high；从均衡档升级到强档时提高推理等级，四档职责和失败升级次数保持不变。

优先级：角色/阶段合法性 → 任务覆盖 → 风险下限 → 失败次数升级 → 当前Codex可用性与effort校验。

默认失败0–1维持当前档，2–3提升一档，4–5提升两档，6–7到frontier，8次停止。它是调用方传入的已证实失败计数，不是自动重试器；环境故障应先处理环境。high至少Sol，critical使用Astra。低成本模型不等于更低质量要求。

## 使用

从AGT根目录运行。以下project为示例，不会自动采用到已有产品。

~~~bash
# 当前模型与effort，不创建thread/turn
node adapters/codex/agt-models.mjs catalog

# 只解析推荐；没有切换当前App聊天
node adapters/codex/agt-models.mjs resolve \
  --stage implementation --role frontend-implementer/base --task coding

# 高风险小改动也不能落到Luna
node adapters/codex/agt-models.mjs resolve \
  --stage implementation --role backend-implementer/base \
  --task coding --risk high

# test执行不需要Codex或模型清单
node adapters/codex/agt-models.mjs resolve \
  --stage verification --role quality/base --task test-execution
~~~

用户明确采用后，生成新的版本化锁。输出目录应已存在；拒绝覆盖文件。approval是批准引用，不是绕过原阶段审批的授权凭据。

~~~bash
node adapters/codex/agt-models.mjs lock \
  --output ../project/.planning/agt/model-routing-v1.lock.json \
  --approval DEC-model-routing-001
~~~

锁包括政策快照/hash、model/effort、发现时CLI版本/能力和批准引用。它与consumer-ai-web的产品Profile独立版本化，不修改已锁定的PROFILE.yaml，也不复制角色Prompt到产品。

根据 [任务包模板](../../templates/model-task.json) 准备真实的批准输入、范围、验收、风险和先前失败摘要，再预览：

~~~bash
node adapters/codex/agt-models.mjs launch \
  --project ../project \
  --lock ../project/.planning/agt/model-routing-v1.lock.json \
  --packet ../project/.planning/current-task.json \
  --task coding
~~~

默认dry-run，仅校验/输出配置。真正启动需加 --run；启动器从state/registry确认唯一活动角色，按锁定策略用参数数组运行：

~~~text
codex exec --model <selected-model> \
  -c 'model_reasoning_effort="<selected-effort>"' -C <project> -
~~~

任务包走stdin，不拼入shell命令，不在预览中打印全部内容。Skill路径、职责、状态/上游检查、保留他人修改和验收要求都会传入执行者。启动器不会放宽sandbox、审批、网络权限，也不会修改state/registry。未知选项拒绝，不允许借透传参数覆盖已选模型。

执行提示遵循[按需读取](../../core/role-contract.md#context-reading)：完整角色契约、当前产品入口、任务相关章节及必要依赖，历史按ID检索，模板使用时读取。`inputs`是定位入口，不保证已经列全依赖，也不是强制文件访问白名单；适配器不拦截后续文件读取。静态大小可用[计量工具](../../validators/measure-context.mjs)检查，不能当作已观测的模型输入或token账单。

**这是新Codex会话，不是App当前主会话的热切换。** 实际模型未被运行时事件证实时输出actual_model=not_observed；不伪造切换成功。App工作可手动按推荐选择模型，或由支持model/effort覆写且已获委派授权的宿主使用原生子任务。此版本不自动创建子代理、不托管当前聊天、不自动办理角色迁移。bootstrap/control的resolve用于推荐；launch仅支持已有active项目身份，不替代初始化/守门器激活。

## Codex更新后的处理

每次launch重新运行Codex --version及app-server model/list，含分页、超时与协议错误处理。即使CLI版本没变，也检查服务端清单变化。可主动检查：

~~~bash
node adapters/codex/agt-models.mjs check-updates \
  --lock ../project/.planning/agt/model-routing-v1.lock.json
~~~

输出CLI版本变化、策略差异、新增/移除模型、effort变化和upgrade候选。模型/effort失效时退出码2并阻止launch；无效协议或发现失败退出码1。不静默改成“latest”，也不在发现失败后以旧缓存声称可用。

本次1.1.0更新将economy从GPT-5.6 Luna改为GPT-6 Luna，balanced从GPT-5.6 Terra改为GPT-6.1 Sol / medium，strong从GPT-5.6 Sol改为GPT-6.1 Sol / high。frontier继续使用GPT-6 Astra / high。已有1.0.0锁仍按原模型解析，中央策略更新本身不改写旧锁；旧模型不再出现在当前清单时按既有规则阻塞。

策略允许显式配置`ultra`，但必须由当前Codex `model/list`确认该模型支持。本机0.159.3清单中的GPT-6.1 Sol和GPT-6 Astra支持`ultra`，GPT-6 Luna不支持；默认档位继续使用medium/high。API模型页的effort列表不能代替Codex运行时能力。

更新流程：

1. 查询当前清单、核实官方能力/成本；不能按名称排序猜最强或最便宜。
2. 同一组代表任务比较质量、返工和总用量：普通UI、DTO转换、权限错误态、SSR异常、契约验证和文档整理至少各一例。
3. 修改中央policy的对应binding与version/verified_at；用--policy candidate.json预检。新模型必须支持既有effort，否则明确修改候选并重新比较，不静默降级。
4. 用户确认后以lock写入model-routing-v2.lock.json，后续launch显式采用新锁。旧锁不覆盖；回滚时选择旧锁，前提是旧模型仍可用。

**自动检测，受控调整**：没有后台计划任务，没有自动改全局 ~/.codex/config.toml。官方upgrade提示不等于质量/成本等价保证。全自动迁移需要另行定义成本上限、固定评测门槛和回滚条件。

## 测试与边界

~~~bash
node --test tests/model-routing.test.mjs
./validators/validate-profile.sh profiles/consumer-ai-web/PROFILE.yaml
~~~

--inventory允许resolve/lock/check-updates使用规范化JSON快照，用于离线评审/测试；launch不能使用离线清单，始终实时预检。--codex指定另一安装位置；测试使用本地替身，不发付费模型请求。

40项自动化测试通过，覆盖策略/风险映射、bounded escalation、模型/effort阻塞、元数据分页/错误/超时、锁不可覆盖、旧绑定兼容、ultra能力限制、状态角色不匹配、路径边界、默认dry-run、所选model/effort进入执行参数和无权限提升参数。实机CLI 0.159.3仅做模型发现和1,128组角色/任务/风险/失败次数路由检查，以及ultra能力核对；未运行真实收费编码任务。替身验证启动链路，**不证明各模型对实际项目的质量或节省比例**。

当前没有账单/usage采集、预算熔断或持久化失败计数器；总成本需含主会话、执行者、重试与返工，缺usage标unknown。不能用API价格计算Codex订阅扣费。将来模型调整只改中央映射，不必逐个重写角色。

## 官方依据（2026-10-05核验）

- [Codex子代理模型与effort](https://learn.chatgpt.com/docs/agent-configuration/subagents)：工作可选不同模型，未指定时可能继承；分派本身也消耗tokens。
- [Codex App Server model/list](https://learn.chatgpt.com/docs/app-server#list-models-modellist)：运行时模型、effort、分页和upgrade元数据。
- [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)、[GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)、[GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)：能力定位；API参数与Codex可用性分别核实。

任务分工是AGT工程建议，不是OpenAI对每类任务结果的保证。路由预检以当前Codex返回的模型清单为准；清单中的条目不是实际调用成功或账号权益的证明。
