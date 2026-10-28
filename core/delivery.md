# 按任务交付与里程碑封闭

`consumer-ai-web@3.0.0` 的交付协议使用分支内版本化 planning。采用 `.agt/delivery.json` 的 schema 2、`planning_storage: branch` 后生效。旧锁定项目必须显式迁移；基座更新不自动改写产品。

## 分支与继承

- 里程碑从 main 创建 `milestone/<ID>`，记录实际起点提交及已完成的前序里程碑。M002 继承 M001，M003 继承已完成 M002；新需求只维护本轮增量及替代关系。
- 独立 Quick 从 main 创建 `quick/<ID>-<slug>`，自己的计划、正文增量和验证记录位于任务范围。Quick 可引用封闭里程碑，不得回写其目录。
- workstream 从所属里程碑或 Quick 分支创建，只普通合并回该父分支；它不能直接进入 main。
- 父任务收尾后统一 squash 合入 main。main 接收最终代码及整理后的有效 `.planning`，不接收本次开发分支的过程提交历史。旧 Git 历史不重写。
- 开发分支可以正常提交和按授权推送 `.planning`；“不能提前进入 main”不等于“仅存本地”。构建输出、临时日志和无效截图不默认提交。

已完成里程碑提供只读基线，后续不复制整套文档，也不重新汇编整个项目。main 新增独立 Quick 后，活动里程碑同步并复核受影响契约。全局控制入口随新任务更新，不能借更新入口改写封闭正文。

## 责任与资料

专业角色负责语义，交付负责人负责收敛时点与最终一致性，守门角色同步状态。产品整理规则和验收，设计整理正式来源，技术角色整理模型/API/架构，实现角色整理实际交付，QA 整理当前测试及必要证据。只组织受影响责任，不为小任务强制完整角色链。

| 用途 | 处理 |
|---|---|
| current | 本轮有效正文、设计、测试、最终结论及必要接受依据，保留在所属权威位置 |
| obsolete / temporary | 已修复且验证通过问题的过程记录、废弃稿、过期日志/截图和重复内容，责任人确认后删除 |
| unresolved | 未解决、未验证、待接受事项，保留影响及下一步，不能借清理关闭 |
| unknown | 原地保留交责任人确认，阻止受影响交付收尾 |

“压缩归档”是语义整理，不生成 tar.gz/zip/压缩 JSON。现有包仅提取独有有效内容，随后删除；不为无效资料另存副本或维护恢复索引。回归测试有价值就保留，不附带历史 bug 叙事。详见[文档整理](./document-maintenance.md)。

## 一次初始化，持续复用

产品政策记录 main 分支、分支交付模式、采用来源和部署说明。部署方式、构建/检查/回滚步骤沿用既有工程文档；未确定的部署项写未配置，不阻塞开发。只记录凭据引用，不保存密钥。

采用命令为 `node <基座>/adapters/delivery/agt-delivery.mjs init --project <产品> --input <配置JSON>`。配置声明 `schema_version: 2`、`planning_storage: branch`、`main_branch: main`、`adoption_source` 和 `deployment_document`。已跟踪 `.planning` 是正常输入，不移出索引、不增加整目录忽略。

首次升级比较旧锁、已采用补丁和新契约，识别消费者并修复依赖。已封闭里程碑的存量整理必须有独立明确的一次性整改范围，完成后重新封闭，保持原接受结论。普通升级不授予历史重写权限。

## 工具入口

- `start --id M002 --path <新worktree> --predecessor M001 --approval <来源>` 从 main 创建里程碑；Quick 使用 `--id Q001-slug`。
- `inventory --id <UNIT>` 枚举文件；责任人完成清理后，`review --id <UNIT> --input <JSON>` 记录 reviewer/outcome/verification/limitations/retained_items/materials。materials 逐文件使用 current 或 unknown；上表 obsolete/temporary 必须先处理，不能改标签混入最终材料。
- `close --id <UNIT> --input <JSON>` 接受最终事实（status/approval/evidence），保存 `.agt/deliveries/<UNIT>/summary.json`；阶段接受条件仍需满足。
- `prepare --id <UNIT>` 创建 squash 候选；`verify --id <UNIT> --input <JSON>` 的 commands 为 argv 数组，并带 reviewer/approval；`finish --id <UNIT>` 只更新已通过且源/目标未漂移的候选。
- `consolidate --id <父UNIT> --child <子ID> --reason <原因>` 在子需求已接受且集成、父正文已复核后收敛子摘要，保留最小集成对应关系，避免父目录清理使旧子摘要失效。
- `adopt-closed --id M001 --input <JSON>` 只用于一次性存量整改：声明 maintenance、original_acceptance 的 commit/path、predecessor；误编号历史可用 additional_roots 声明明确的 M002-legacy-MNNN 所属目录，不作为新里程碑。原完成结论不变。已完成旧 Quick 同样可用 adopt-closed，读取原 task.json complete 或显式 original_completion 的 commit/path；不会导入旧快照，也不声称重新测试，活动任务不能使用此入口。
- `show --id <UNIT>` 查看最终结果及交付提交。`check --staged` 或 `check --base <提交>` 检查当前索引/候选。
- 一次性存量整改的 `--maintenance <JSON>` 明确 source、ids、branch、base_commit，仅适用指定分支和基线，不能降低原完成状态或普通开放封闭目录。

命令统一带 `--project <产品路径>`。UNIT 为里程碑、Quick 或子需求；最终 squash 只接受父任务。`extract` 仅供显式读取旧版本归档，不属于新版整理流程。

## 收尾顺序

1. 汇合本次交付范围的 workstream，核对其接受结果及必要依赖，固定待交付候选。
2. 各责任角色按当前实现与已确认要求收敛正文，删除无效资料；两者有差异时记录待解决项，不直接用代码覆盖需求。
3. QA 核对当前版本的最终结果和限制；纯文档删除/链接修复不重跑无关业务测试。
4. 交付负责人运行 inventory/review，复核有效材料和版本，确认开放事项、引用及最终提交范围。未知用途和过期复核不能收尾。
5. Quick finish / workstream accept 保存最终完成记录和可读 summary，不生成归档包。阶段必需产物不等于永久保留清单；依据最终有效内容验收。
6. 父任务在所需接受完成后建立最终 squash 候选，检查组合结果及源/目标版本，合入 main 并记录源提交与交付提交关系，封闭任务。

仅本次候选停止接受未验证变更，其他独立分支继续。main 或候选变化后重新核对；不得把旧测试结果直接套到新的组合版本。最终记录保留结果、版本、验证、限制和必要证据，不依赖被删除的失败日志维持完成状态。

## 封闭、Git 与恢复

- 已封闭里程碑所属文档、设计、测试记录和完成结论只读。新增产品变化写在后续里程碑或 Quick；项目源代码可正常演进。
- 提交前运行 `check --staged`；候选与推送检查使用实际基线，核对封闭范围和交付结果。这是显式工具检查，不是已安装的 Git hook；普通 Git 可以绕过它，不能宣称全局自动保护。
- workstream 保留写入租约、集成锁、临时 worktree 和组合验证；子→父使用普通合并，父→main 才 squash。不能以祖先判断替代最终 squash 收据。
- Git 提交恢复活动资料；未提交修改仍需正常保存，不声称已自动备份。清理 worktree 前检查未保存、忽略和未集成内容，不使用 force/reset/clean 隐藏工作。
- 不用无范围 `git add .`，不混入他人工作，不为写回自身 SHA 反复提交。不自动推送、发布或部署；这些行为沿用用户已有授权和部署策略。

<a id="产品工程输入边界"></a>

## 工程输入

产品构建、常规单测/集成/E2E 与 CI 不读取 `.planning`、压缩包、其他 worktree 或开发者私有文件。固定样本及预期进入正式 tests/fixtures、testdata 等目录；预期不能从被测实现即时生成。不能通过缺少 planning 时跳过测试获取通过。

设计来源核对是显式创作流程，可按需读取有效规划来源，但不混入常规产品构建。用干净候选验证工程输入独立性，同时检查必要数据库/服务替身等声明依赖。
