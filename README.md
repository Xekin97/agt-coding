<!-- generated-by: gsd-doc-writer -->
# agt-coding

面向 Codex 的产品生成器 AI 角色基座：通过可组合的高级专业角色、显式工作流和文件化产物，协助用户把产品构想逐步推进为可验收的软件产品。

> 当前状态：基础骨架开发中。核心契约、基础角色、仓库级 Skills、产物模板、校验器、To-C AI Web Profile和可选Codex模型分档适配器已经建立；完整初始化适配和通用升级流程仍待实现。

## 它解决什么问题

`agt-coding` 不是具体产品的源码仓库，也不是无人参与的一键代码生成器。它是一套可独立升级的研发协作基座，负责定义：

- 谁参与产品研发，以及每个 AI 专业角色的职责和权限边界；
- 如何从产品策划推进到 UI/UX、技术方案、实现和验证；
- 每个阶段需要产生哪些可追踪的正式产物；
- 哪些重要决定必须由用户确认；
- 如何在会话中断后依据文件状态恢复工作；
- 如何让基座升级与具体产品代码保持隔离。

## 核心设计

### 每个产品一份独立基座

每个产品使用一份独立的 `agt-coding` 克隆，同时拥有一个独立的产品 Git 仓库。建议将两者放在同一个非 Git 父目录下：

```text
my-product-workspace/
├── agt-coding/    # 角色与工作流基座，可从上游升级
└── project/       # 产品产物、决策、状态与实现代码
```

产品专属内容不得写入 `agt-coding` 的受版本控制文件。基座保持干净，产品仓库记录所使用的基座 revision 和 Profile 版本。

### Profile 推荐整套角色组合

项目启动时，初始化角色通过结构化问卷了解产品类型，再从基座中推荐最多三个已经存在的 Profile。Profile 会整体定义兼容的角色组合、工作流、必需产物和默认策略，最终选择权属于用户。

同一角色类别可以由基座维护多个变体，例如 `product/to-b` 和 `product/to-c`。产品选择已有变体，但不在产品仓库内定制或复制角色 Prompt；通用改进应回到基座演进。

当前提供 `consumer-ai-web@3.0.0`，适用于面向公众消费者、以 AI 内容生成或转换为核心价值，并需要账号、权益分组、用量控制和完整前后端交付的响应式 Web 产品。初始化角色仍必须先完成问卷、展示匹配与不匹配项，并等待用户明确选择。

### 专业角色直达用户

专业角色直接与用户讨论并展示原始产物。阶段守门器只负责角色激活、条件检查、状态迁移、恢复和回溯，不转述、压缩或代替专业角色的内容。

```text
工作面：用户 <-> 当前专业角色 <-> 原始专业产物
控制面：状态文件 <-> 阶段守门器 <-> 显式状态迁移
```

聊天话题的变化不会自动改变阶段。只有用户明确要求提交验收或进入下一阶段，守门器才会检查条件并更新正式状态。

### 语义化角色名称

每个角色在启用前必须获得稳定、可读的 `<role-prefix>-<person-name>` 名称，例如：

- `product-maya`
- `designer-tony`
- `dba-diana`
- `backend-alex`
- `frontend-bob`
- `qa-quinn`

哈希、UUID、时间戳和平台 runtime ID 不得作为用户可见名称。运行时名称和 ID 可以单独保存，但工作流、交接记录与用户对话始终使用语义名称。

## 多窗口需求并行

新增 `$agt-workstream`：同一里程碑或 Quick 父任务内，每个需求拥有独立分支、worktree、阶段状态、角色和专业产物。A 窗口可以做登录优化的设计，B 窗口同时实现学习报告。

没有固定主窗口。任意产品 worktree 都能查看、恢复或发起集成；合并在临时 worktree 验证，通过后才更新指定集成分支。写入会话租约和共享集成锁避免多个遵守协议的窗口竞争同一需求或目标。关闭窗口后依据 Git 与文件恢复。

```text
$agt-workstream 创建 登录优化
$agt-workstream 创建 学习报告
$agt-workstream 查看
$agt-workstream 集成 登录优化
```

专业工作继续使用原有 agt skills 和阶段守门器。旧项目默认保留单流程；显式采用兼容 Profile（2.1.0 起）的可选能力后启用。详见[工作流协议与命令](core/workstreams.md)和[skill 入口](.agents/skills/agt-workstream/SKILL.md)。脚本入口：

```bash
node adapters/workstreams/agt-workstream.mjs --help
node --test tests/workstreams.test.mjs
```

## 研发流程

### 小任务：AGT Quick

已有明确范围的小修复、小增强、测试、配置和文档工作可以直接说“修复这个问题”，或使用 `$agt-quick <任务>`。执行者采用短计划、针对性验证与一份可恢复任务记录，无需新建/重开里程碑；已完成 M002 也可以作为参考基线。任务完成、人工接受、Git 提交与发布分别判断。

Quick 按影响组织产品、设计、技术、QA 和交接责任项：变更写回对应正式文档，任务记录保存责任映射与真实执行回执。上游未确认、正文未回写或版本已变化会阻止下游验收/任务收尾。支持已授权 agent 接手任务包，也可按责任串行执行；串行处理不能冒称独立验收。详见[文档责任](core/quick-tasks.md#变更回落与文档责任)。

收尾必须完成本批文档的语义整理并登记 `compact`，随后 `finish` 检查有效验收、正文增量和整理回执。`show/resume` 默认精简；已修复且验证通过问题的过程记录、旧失败附件和废弃稿清除，必要回归测试保留。独立接续未运行时如实记录 NOT_RUN。详见[上下文收尾](core/quick-tasks.md#上下文收尾与归档)。

```text
$agt-quick 修复设置页保存后提示未更新的问题
$agt-quick list
$agt-quick status Q001-fix-settings-feedback
$agt-quick resume Q001-fix-settings-feedback
```

范围清楚就直接执行，出现影响验收的重要新决定再澄清；多需求完整交付仍使用原需求/里程碑流程。详见[粒度与执行协议](core/quick-tasks.md)、[Skill](.agents/skills/agt-quick/SKILL.md)及[任务模板](templates/quick-task.json)。旧锁定项目显式迁移后采用 3.0 分支交付；Quick 可以作为 workstream 父任务，子需求只集成回所属 Quick。命令入口 `node adapters/quick/agt-quick.mjs --help`，行为测试 `node --test tests/quick-tasks.test.mjs`。

### 里程碑交付

一个里程碑按照以下阶段推进：

```text
产品策划
  -> 用户验收
UI/UX 设计
  -> 用户验收
数据库与前后端技术方案
  -> 用户验收
前后端实现
  -> 开发期质量检查
产品验证与人工验收
  -> 里程碑完成
```

专业角色只能建议进入下一阶段，不能自行迁移状态。发现上游范围、设计或契约问题时，应创建变更请求并返回对应责任阶段。

### UI 设计、准确交接与整改

UI/UX 同时负责设计质量和产物对后续 agent 的可用性：从用户当前目标推导构图、字体、色彩、层次及交互，在浏览器检查实际效果。当前设计通过 `design/design-spec.md` 提供版本、原型启动、页面/区域/状态和资源定位；`design/copy.json` 提供原型与前端复用的准确文案，主题、交互及响应式继续使用原有产物。

前端读取原型 HTML/CSS、文案和资源，按批准技术方案忠实转换。提交 QA 前核对运行页面的文案、元素数量/顺序、显示条件、视觉和交互，修复基础偏差；QA 对同一有效版本独立验证。详细责任、来源和证据规则集中在[设计交付协议](core/design-delivery.md)，编制时使用[设计规格模板](templates/design-spec.md)，交接单只链接当前入口。

浏览器检查先在现有矩阵选择冒烟、需求验收、缺陷复验或有界探索，明确条目、充分证据与软预算。结构化断言、必要视觉比较和实际动效检查各自证明适用结果；返工只重验问题及受影响使用处。保存截图与送模图片分开计量，证据充分后及时收尾。具体执行见[检查与证据](core/design-delivery.md#verification)，不新增测试平台、必需产物或审批阶段；规则接入不等于已证明 token 节省。

用户要求设计整改或重构时，按本轮目标重做受影响结构并同步更新原型、文案、样式、资源及交接，不默认在旧设计上增量修补。废弃稿在有效内容收敛后清除，封闭前序里程碑作为只读继承基线；新稿批准范围单独记录，下游重新核对版本。规则接入不等于实际还原率已验证，首次试点应记录设计质量、首次交付偏差和 QA 往返。

2.0.0 新增两项必需设计产物，属于交付契约变更；既有产品按锁定的基座 revision/Profile 继续运行，升级差异与采用范围见[Profile 升级说明](profiles/README.md#交付契约与升级)。

### 先确认理解，持续整理文档

- 所有角色遵守[禁止自发性过度设计](core/role-contract.md#no-speculative-overengineering)：只围绕已确认需求与有证据的实际问题设计、开发和验证；不以无依据的“完善”为由扩展范围，额外建设先获用户明确同意。
- 计划相关角色在关键解释有歧义或准备引入新约束时，先说明理解、非目标和必要正反例，等用户确认后再展开依赖它的方案。用户已明确的要求直接记录，不反复索取相同批准；用户纠正会撤销旧推断及其下游前提。
- 每轮实质修订收敛后、交接前整理本角色文档：更新现有主文档，合并重复说明，当前交接只链接真源，不复制整段历史。区分阶段必需产物与最终有效内容，保留当前接受结论及必要证据，清除已修复问题的过程资料；测试截图按[用途与保留规则](core/document-maintenance.md#evidence-retention)处理，不为无效资料打包或建立恢复索引。

具体边界集中维护在[需求确认闭环](core/role-contract.md#requirement-confirmation)和[文档整理](core/role-contract.md#document-maintenance)，各Skill在计划与交接环节引用，避免维护多套相同规则。确认来源和整理结果直接使用现有决策/交接模板，不新增审批阶段或成套文件。这些是角色执行规则，不是后台自动归档服务。

### 小入口、继承与语义整理

整理保留当前有效知识、设计和测试，以及明确的未完成事项。M002 继承已完成 M001，M003 继承已完成 M002；每轮维护自身增量及替代关系，不复制前序资料或重新汇编整个项目。

[读取规则](core/role-contract.md#context-reading)要求先读当前状态、交接和适用基线，再定向读相关正文。状态只维护当前流程和有效入口，不另建第二套台账。各角色整理本轮内容，交付负责人复核跨角色一致性；详见[整理协议](core/document-maintenance.md)。

“压缩归档”是语义收敛和删除无效内容，不是 tar.gz/zip。已修复且验证通过问题的排查记录、过期证据、废弃设计和重复交接清除；工程回归测试、当前必要证据和未完成事项保留。完成验收、文档处理及交付后里程碑封闭只读；历史存量未清理问题只在明确的一次性整改范围内处理，整改后重新封闭。

首次试点或入口大改可做独立接续检查，未执行标 NOT_RUN。`validators/measure-context.mjs` 可对显式文件清单作只读字符/字节计量，不递归展开链接；没有实际 usage 就不能宣称 token/费用节省，文件数量也不是整理质量。

## 按分支交付与里程碑封闭

`consumer-ai-web@3.0.0` 使用 `delivery/base` 与 `$agt-deliver` 组织任务收尾。采用 delivery schema 2、`planning_storage: branch`：代码与 `.planning` 在开发分支正常提交，临时输出忽略。里程碑从 main 建立 `milestone/<ID>`，独立 Quick 建立 `quick/<ID>-<slug>`；workstream 从对应父分支切出并普通合并回父分支，父任务最终 squash 合入 main。

合并前依次完成：汇合交付范围 → 固定候选 → 各角色收敛正文并删除无效资料 → QA 核对当前版本 → 交付负责人检查 → squash 交付并封闭。只限制本次候选，其他独立分支可以继续。main/候选变化后重新核对相关验证。

工具保存可读完成摘要与源/交付提交关系，不生成压缩包，也不要求废弃日志永久存在。阶段 `required_artifacts` 与最终 `final_artifacts` 分开，过期交接可清除。已封闭目录只读，Quick 的变化写入自身增量，不回写前序里程碑。

详见[交付协议](core/delivery.md)、[交付角色](roles/delivery/base.md)及[Skill](.agents/skills/agt-deliver/SKILL.md)。命令 `node adapters/delivery/agt-delivery.mjs --help`；提交前检查索引，最终候选检查封闭范围和版本。这是显式工具检查，不是自动安装的 Git hook。旧锁定项目显式迁移后采用，不自动推送、发布或部署。

## 已有角色与 Codex Skills

仓库级 Skills 位于 `.agents/skills/`，不会安装或同步到用户全局目录。

| Skill | 专业角色与用途 |
|---|---|
| `$agt-start-project` | 项目初始化专家：执行结构化问卷、推荐 Profile 并建立初始状态 |
| `$agt-product-planning` | 高级产品专家：定义范围、数据资产、能力、页面与验收标准 |
| `$agt-uiux-design` | 高级 UI/UX 设计专家：设计或重构原型，交付准确文案、视觉交互规则和可供 agent 使用的设计来源 |
| `$agt-database-design` | 高级 DBA：设计模型、约束、索引、事务、迁移与恢复策略 |
| `$agt-backend-design` | 高级后端架构师：设计模块、Markdown API 契约、可靠性与部署 |
| `$agt-frontend-design` | 高级前端架构师：设计路由、组件、状态、数据访问与工程方案 |
| `$agt-backend-implement` | 高级后端开发：实现已批准方案并完成开发期质量检查 |
| `$agt-frontend-implement` | 高级前端开发：实现已批准 UI 与前端方案并完成开发期质量检查 |
| `$agt-workstream` | 多窗口需求工作流：创建、查看、恢复、集成与清理 |
| `$agt-quick` | 有界小任务：短计划、实施、针对性验证、查看与恢复；不重开里程碑 |
| `$agt-verify-milestone` | 高级产品质量专家：验证 UI、API、集成、E2E 与用户验收 |
| `$agt-deliver` | 交付负责人：资料语义复核、封闭、提交/合并、changelog与部署策略 |
| `$agt-stage-gate` | 阶段守门专家：显式激活角色、验收、迁移、恢复或回溯 |

实现角色负责单元测试、lint、格式化、类型检查和适用的模块集成检查。验证阶段检查这些证据，并聚焦用户可观察行为、契约、集成和验收，不机械重复开发期检查。

## 可选的分档模型编排

模型按“阶段默认＋任务覆盖＋风险下限＋失败升级”选择，不将每个角色永久绑定一个模型：需求/架构用GPT-6 Astra / high，计划/设计判断/独立验收用GPT-6.1 Sol / high，明确编码/单测/文档用GPT-6 Luna / medium，事务性守门检查用GPT-6.1 Sol / medium，纯test/lint/build直接交工具。

已提供[中央策略](models/codex-balanced.json)、[调度契约](core/model-routing.md)、[任务包](templates/model-task.json)和[可执行Codex适配器](adapters/codex/README.md)。它查询真实模型能力、生成不可覆盖的版本化锁，并按任务包分派到原生子代理或新的Codex CLI会话。Quick 使用任务级范围，支持里程碑已完成、无活动角色的情况。尝试记录累计有证据的实现失败，保存运行时观测和可用的会话 usage；exit 0 不等于验收通过。CLI launch 默认dry-run，不热切换已打开的App聊天，不修改全局Codex配置，也不自动升级已有产品。

AGT 语义整理按职责分配：明确整理用 Luna，复杂保留规则和语义复核用 Sol，文件、hash 与链接检查交工具。`compact` 登记并核验已完成的整理，不是聊天压缩或自动写文档命令。

每次启动检测Codex版本和可用模型变化；新增模型只生成更新建议，模型/effort失效明确阻塞。确认新映射后生成新锁，保留旧锁。详见适配器文档中的命令与限制。

## 快速开始

### 1. 准备双仓库工作区

```bash
mkdir my-product-workspace
cd my-product-workspace
git clone git@github.com:Xekin97/agt-coding.git agt-coding
mkdir project
git -C project init -b main
```

也可以把已有产品仓库克隆为同级的 `project/`。

### 2. 在 Codex 中打开工作区

确保 Codex 可以读取 `agt-coding/` 并写入同级产品仓库。基座 Skills 从 `agt-coding/.agents/skills/` 发现，不需要复制到全局 Skills 目录。

### 3. 启动项目

```text
$agt-start-project
```

初始化角色将分组执行产品问卷、比较已有 Profile，并等待用户明确选择。选择完成后，产品仓库应生成项目清单、角色注册表和工作流状态，再进入产品策划阶段。

当前 Profile 可以参与初始化推荐；正式锁定前仍需确保基座已经形成可记录的 Git revision。

## 仓库结构

```text
agt-coding/
├── .agents/skills/   # Codex 仓库级工作入口
├── core/             # 所有角色共享的职责与流程契约
├── models/           # 可版本化的模型分档策略
├── adapters/         # Codex 模型调度与需求 worktree 管理
├── profiles/         # 可选择的角色、工作流、产物和默认策略组合
├── roles/            # 基础专业角色及角色变体
├── templates/        # 决策、变更、交接、状态与契约模板
├── validators/       # 结构和命名校验脚本
└── tests/            # 调度与适配器测试（无真实模型推理调用）
```

计划补充但当前尚未落地的内容包括独立 `workflows/`、其他运行时适配器，以及更完整的产物和通用升级校验器。

## Profile 校验

每个 Profile 位于 `profiles/<profile-id>/PROFILE.yaml`。提交或推荐前运行：

```bash
./validators/validate-profile.sh profiles/consumer-ai-web/PROFILE.yaml
```

只有通过校验并声明为 `status: available` 的 Profile 才能被初始化角色推荐。完整字段与阶段规则见 `profiles/README.md`。

## 角色名称校验

可以直接检查一个候选角色名称：

```bash
./validators/validate-agent-name.sh frontend-bob
```

合法前缀为 `bootstrap`、`gatekeeper`、`product`、`designer`、`dba`、`backend`、`frontend`、`qa` 和 `delivery`。人名部分使用 2～16 位小写字母，并且不能是哈希式或无语义占位名称。

## 基座升级原则

产品使用的基座版本必须在产品仓库中锁定。升级需要先比较 Profile、角色、模板和状态结构的变化，再由用户决定是否采用。

基座升级本身不授权批量重写已有产品产物、删除历史或切换阶段。采用更新后，各角色在当前任务范围整理自己维护的正文；已封闭里程碑只读，历史存量整改需有明确的一次性范围。整理冗余不等于修改需求、删除数据或引入旧版兼容；这些事项继续按明确授权处理。
