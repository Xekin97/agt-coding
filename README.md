<!-- generated-by: gsd-doc-writer -->
# agt-coding

面向 Codex 的产品生成器 AI 角色基座：通过可组合的高级专业角色、显式工作流和文件化产物，协助用户把产品构想逐步推进为可验收的软件产品。

> 当前状态：基础骨架开发中。核心契约、基础角色、仓库级 Skills、产物模板、角色命名校验器以及首个可选择的 To-C AI Web Profile 已经建立；完整初始化适配和升级流程仍待实现。

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

当前提供 `consumer-ai-web@1.0.0`，适用于面向公众消费者、以 AI 内容生成或转换为核心价值，并需要账号、权益分组、用量控制和完整前后端交付的响应式 Web 产品。初始化角色仍必须先完成问卷、展示匹配与不匹配项，并等待用户明确选择。

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

## 研发流程

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

## 已有角色与 Codex Skills

仓库级 Skills 位于 `.agents/skills/`，不会安装或同步到用户全局目录。

| Skill | 专业角色与用途 |
|---|---|
| `$agt-start-project` | 项目初始化专家：执行结构化问卷、推荐 Profile 并建立初始状态 |
| `$agt-product-planning` | 高级产品专家：定义范围、数据资产、能力、页面与验收标准 |
| `$agt-uiux-design` | 高级 UI/UX 设计专家：产出浏览器可运行原型、交互与设计系统 |
| `$agt-database-design` | 高级 DBA：设计模型、约束、索引、事务、迁移与恢复策略 |
| `$agt-backend-design` | 高级后端架构师：设计模块、Markdown API 契约、可靠性与部署 |
| `$agt-frontend-design` | 高级前端架构师：设计路由、组件、状态、数据访问与工程方案 |
| `$agt-backend-implement` | 高级后端开发：实现已批准方案并完成开发期质量检查 |
| `$agt-frontend-implement` | 高级前端开发：实现已批准 UI 与前端方案并完成开发期质量检查 |
| `$agt-verify-milestone` | 高级产品质量专家：验证 UI、API、集成、E2E 与用户验收 |
| `$agt-stage-gate` | 阶段守门专家：显式激活角色、验收、迁移、恢复或回溯 |

实现角色负责单元测试、lint、格式化、类型检查和适用的模块集成检查。验证阶段检查这些证据，并聚焦用户可观察行为、契约、集成和验收，不机械重复开发期检查。

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
├── profiles/         # 可选择的角色、工作流、产物和默认策略组合
├── roles/            # 基础专业角色及角色变体
├── templates/        # 决策、变更、交接、状态与契约模板
└── validators/       # 结构和命名校验脚本
```

计划补充但当前尚未落地的主要目录包括 `workflows/`、`adapters/` 以及更完整的产物和升级校验器。

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

合法前缀为 `bootstrap`、`gatekeeper`、`product`、`designer`、`dba`、`backend`、`frontend` 和 `qa`。人名部分使用 2～16 位小写字母，并且不能是哈希式或无语义占位名称。

## 基座升级原则

产品使用的基座版本必须在产品仓库中锁定。升级需要先比较 Profile、角色、模板和状态结构的变化，再由用户决定是否采用。

兼容性补充遵循“只增不改、不清理冗余”：只补充后续流程确实需要的缺失内容，不自动重写既有产品产物，不删除历史内容，也不静默改变当前阶段和角色。
