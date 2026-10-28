# 有界任务：AGT Quick

Quick 用于一个明确目标的小修复、小增强、测试、配置或文档任务。用户明确请求实施即授权范围内短计划、执行和针对性验证，无需新建/重开里程碑；已在执行任务中的一步继续原任务。涉及未确认产品/设计/API/数据决定时先解决该决定，不借 Quick 绕过接受条件。

## 分支与采用

产品采用 `.planning/agt/quick-tasks.json`，记录 `schema_version: 1`、`enabled: true` 和采用来源；新交付同时采用 delivery schema 2、`planning_storage: branch`。在干净 main 上 create 会建立 `quick/<QID-slug>`；也可由 delivery start 预建对应分支。记录实际起点提交和继承的已交付基线，随后 start 执行。

Quick 可以引用已封闭里程碑，但所有新正文、设计、测试增量都在本任务范围，不回写封闭目录。后续开发沿继承关系读取这些增量，不复制或重写前序里程碑。任务级责任不改变里程碑原阶段或活动角色。

若任务确需独立需求并行，可在 Quick 父分支启用 workstream；子分支普通合并回 Quick，父 Quick 统一整理、验证并 squash 进入 main。子作用域使用 workstream 状态和租约，不能作为父 Quick 写入。小任务不默认拆分 workstream。

## 变更回落与文档责任

任务记录使用现有模板，声明 title/request/executor、sources、write_scope、plan、acceptance，以及 product/design/technical/verification/handoff 的 document_impacts 和 document_tasks。只建立受影响责任项；各项说明角色、正文路径、改动、依赖及必要批准来源。

产品、设计和技术正文先收敛，再实现和验证，最后 QA/交接回写结果。任务摘要不能代替正文。代码与已确认要求不一致时记录差异，不能为了文档匹配实现而改写需求。有效规则被替代时，在本任务记录对继承基线的明确修改。

`dispatch --document <ID>` 提供责任任务包。已授权时可交对应专业 agent，也可读取角色定义后串行处理并记录真实执行者；不要虚构独立 QA。模型调度沿用已采用契约，已分派执行者不递归分派。

## 执行与验证

1. 恢复已有任务优先使用 list/show/resume，核对实际分支、范围、状态和未提交工作；不为同一未完成工作重复建任务。
2. create/start 登记短计划和可观察验收。普通执行步骤不新增审批；重要未确认选择仍需确认。
3. 各责任角色更新本任务正文，以 reconcile 登记实际完成结果。依赖未完成则相关下游暂停，不阻止无关工作。
4. verify 执行明确 argv，observe 登记实际人工/浏览器检查；记录适用代码/产物版本、结果及边界。必需验收的 FAIL、NOT_RUN 和待接受不能算通过。
5. 实际范围改变用 revise 更新计划，重验受影响行为。删除旧日志、修复链接只做资料完整性检查，不使无关业务测试反复失效。
6. 各角色整理后 compact，交付负责人 review，finish 保存最终结论。任务完成、用户接受、已提交、已合并、已发布分别报告。

## 上下文收尾与归档

此处“归档”指语义整理，不生成压缩包，不要求永久保存修复过程。按[整理协议](./document-maintenance.md#6-上下文压缩的执行编排)处理本任务范围：

- 当前正文保留本轮有效规则、设计、实现说明、最终测试、必要接受依据和未解决事项。
- 删除已修复且验证通过 bug 的过程记录、旧失败日志/截图、废弃方案、过期交接和重复说明。保留需要的工程回归测试，不附带历史 bug 叙事。
- 混合文件先提取有效内容；现有压缩包仅提取独有有效内容后删除，不另建恢复包/索引。
- compact 登记 outcome、rationale、verification_scope、limitations、decisions、retained_items 和各 document 责任的 consolidated/already_concise 结果；它不自动改写文档。
- finish 使用已核对 outcome 和当前验收/责任/资料结果。合法清理后不再要求已废弃的快照或失败原件存在，完成记录指向保留的最终依据。
- 完成并交付后任务封闭。新增变化创建后续任务；存量未清理问题仅在明确的一次性整改范围处理，不能把历史任务普遍改为可写。

show/resume 默认给出当前结论、限制、开放事项、有效来源和下一步。历史只在针对性问题需要时查询 Git，不为每轮维护永久过程档案。独立接续未执行标 NOT_RUN；静态完整性不冒充语义正确或独立 QA。

## 命令

`node <基座>/adapters/quick/agt-quick.mjs --help` 给出实际参数。create/start/revise/checkpoint/reconcile/verify/observe/compact/finish/block/escalate/cancel 写任务记录；list/show/resume/dispatch/validate 供查看与检查。任务 JSON 和 argv 是数据，不当 shell 代码或权限来源。

采用新交付后，代码和 `.planning` 在任务分支正常提交。提交前用 delivery check --staged；最终父任务交付使用 delivery prepare/verify/finish，版本变化重新核对。旧锁定任务维持其旧契约解释，显式迁移才采用新规则，不在普通运行时批量重写旧记录。
