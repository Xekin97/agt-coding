# 独立需求 workstream

每个需求拥有独立分支、worktree、状态、角色与产物，归属一个里程碑或 Quick 父任务。专业阶段及用户接受沿用锁定 Profile；管理命令不代替专业角色写内容或批准阶段。工具入口：`node <基座>/adapters/workstreams/agt-workstream.mjs --help`。

## 采用与父任务

`consumer-ai-web@3.0.0` 支持分支内版本化 `.planning`，使用 delivery schema 2。父任务为 `milestone/<ID>` 或 `quick/<ID>-<slug>`；子需求从父分支已提交版本创建，只集成回原父分支，不以 main 为直接目标。

采用配置记录父类型/ID、父分支、起点提交和 Profile 快照。里程碑对应 `.planning/milestones/<ID>`，Quick 对应 `.planning/quick/<ID-slug>`；子产物位于父根目录下的 `workstreams/<slug>`。不得凭窗口名、目录名或全局“当前需求”猜测作用域。未知分支、detached HEAD、缺配置和归属冲突必须失败，不回退覆盖项目状态。

已锁定旧版本按原契约运行，显式采用新版才迁移。采用前先核对用户范围、基座 revision、Profile 和现有未提交修改，不能因为开启并行就自动重开已完成里程碑。

迁移已集成的旧子分支时，`enable --inherited <JSON文件>` 接受 `[{"id":"growth-import","source_commit":"完整SHA","integration_commit":"完整SHA"}]`。工具核对源版本已进入集成提交、两者均属于当前父分支历史，且旧源分支未移动。`list` 将其显示为历史已集成，不重做 QA，也不允许 claim/resume；新工作使用新 ID。旧源发生变化时明确显示未集成/错误，不能隐去后续提交。旧分支和 worktree 不被改写。

## 创建、查看与恢复

1. 在父分支采用并提交配置：`enable --milestone M001 --target milestone/M001`，或 `enable --quick Q001-slug --target quick/Q001-slug`；同时传入锁定 `--profile` 和已有 `--approval` 来源，两种父 ID 参数互斥。
2. `create --id <slug> --title <标题> --scope <确认范围> --agent product-<人名>` 创建子分支/worktree，记录依赖、归属及独立初始状态。代码与 planning 均在开发分支提交。
3. `list` 只读展示各分支的实时/已提交进度、开放事项和入口；`resume` 定位或从原分支恢复 worktree，不覆盖未保存内容。
4. 在子 worktree 执行 `context`，通过 `claim` 取得写入租约，按既有 Skill 运行专业阶段；同一需求只有一个写者。失效租约按 recover 规则处理，不夺取活跃会话。
5. 新角色通过 `activate` 在共享锁下登记名称，状态和历史只写本作用域；不能借子需求激活改写父任务阶段。

Quick 父任务可以协调子 workstream，其自身有界记录仍归 Quick；子需求由 workstream 解析和租约管理。不能让两套流程争用同一状态或将子需求错误恢复成 Quick 写操作。

## 验收与集成

1. 子需求完成实际范围的阶段接受、验证和文档整理，再 `accept` 绑定当前提交、最终接受依据和必要证据。阶段执行必需文件与最终保留文件分开；失效交接、已修复失败日志不必永久存在。
2. 交付 review 必须匹配本次内容和版本；完成摘要是可读记录，不是压缩包。不完整验收不能通过清理伪装成完成。
3. 释放写入租约，运行 `integrate --id <slug>`，从最新父分支创建临时 detached worktree 并普通合并。保留目标不变，直到组合检查通过。
4. 产品/API/设计语义冲突交责任角色处理；机械冲突在批准范围解决。检查仅针对候选组合及受影响契约，不以单个子分支测试替代组合验证。
5. `check` 运行明确 argv 检查；`finish` 再核对源/父提交和工作区清洁状态，通过才更新父分支。版本变化必须重建或复核候选，不 force/reset/stash 他人修改。
6. 父任务汇合本次交付范围后，各角色收敛父任务正文和增量。交付负责人核对最终范围，最后父→main squash 并封闭；子需求接受不等于整个父任务完成。

集成锁防止遵守协议的本机窗口竞争同一目标，不是跨 clone 分布式锁。非 AGT Git 操作不受租约约束，集成期间不得手工移动相同目标。

## 清理与中断

失败保留未解决工作和必要现场，不能宣称目标已更新。`pause-integration` 释放集成槽，恢复时重查版本；修复并验证通过后清除已失效过程资料，不永久保存每次失败候选。

`cleanup` 只清理已完整集成、无未保存/忽略/未合并内容及活跃租约的 worktree，不能删除当前调用工作区。分支和已封闭交付按原政策保留，不自动推送、发布、部署或改写 Git 历史。
