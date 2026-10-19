# 需求工作流与任意窗口集成

本协议扩展[工作流控制](./workflow-control.md)，仅在产品显式采用支持并行的 Profile 并提交 `.planning/agt/workstreams.json` 后生效。没有配置的项目继续使用单流程，不迁移旧批准或历史。

## 使用边界与真源

一个里程碑可以有多个需求工作流，每条拥有一个 `agt/M001/<slug>` 分支和一个 worktree。窗口只是会话入口，没有固定主窗口。任意项目 worktree 均可运行管理命令；处理某需求的专业角色必须在该需求 worktree 工作。集成分支上的项目级角色只处理全局约束和整体里程碑验收，不能代替需求自己的审批。

| 范围           | 真源                                                             |
| ------------ | -------------------------------------------------------------- |
| 项目与全局约束      | 原项目清单、锁定 Profile、全局决策                                          |
| 并行采用与目标      | 集成分支上的 `.planning/agt/workstreams.json`，含采用来源和 Profile 快照      |
| 里程碑协调        | 原 `.planning/workflow/state.yaml`，其角色/阶段只适用于项目级协调              |
| 需求边界、分支、依赖   | `.planning/milestones/M001/workstreams/<slug>/workstream.json` |
| 需求状态、角色和审批历史 | 上述根目录下 `workflow/state.yaml`、`agents.yaml`、`history.yaml`      |
| 专业产物         | 上述根目录下原 Profile 的 `product/`、`design/`、`technical/` 等相对结构      |
| 本地锁与集成现场     | Git 公共目录下 `agt-workstreams/`，不提交、不作为审批真源                       |

专业角色先运行 `node <基座>/adapters/workstreams/agt-workstream.mjs context --project <当前产品 worktree>`。解析结果中的 `state`、`agents`、`history`、`artifact_root` 和 `required_artifacts` 覆盖原固定路径的当前工作域；全局约束仍需读取。不要为每个需求复制 Profile 或角色 Prompt，不把别的需求文档当作自己的已批准上游。

解析器按当前分支核对工作流元数据和状态，不依赖终端名称、聊天摘要或全局“当前需求”。未知分支、detached HEAD、配置缺失及元数据冲突不得回退写项目状态。集成临时 worktree 为 detached HEAD，只用于合并和验证，不能启动专业角色。

## 采用与创建

命令入口均为 `node <基座>/adapters/workstreams/agt-workstream.mjs`；依赖 Node.js、Git 和现有校验器使用的 Ruby YAML，不需安装 npm 包。`--help` 列出参数，输出为 JSON，错误退出码为 1。

1. 核对用户已批准的基座 revision 和支持并行的 Profile。当前提供 `consumer-ai-web@2.1.0`；先按已有升级流程更新产品清单，保留旧产物、批准与变更来源。未经批准不自动升级。
2. 在拟定的本地集成分支运行 `enable --project <产品> --profile <基座>/profiles/consumer-ai-web/PROFILE.yaml --target main --milestone M001 --approval <采用来源>`。脚本写采用配置，不改变项目状态或清单；审阅并提交该配置后才可创建需求。
3. 创建示例：`create --project <任一产品 worktree> --id login --title 登录优化 --scope '已确认的登录优化范围' --agent product-alice`。可指定 `--path` 和 `--dependencies '["identity"]'`。用户中文标题保留，slug 使用小写 kebab-case。
4. 从集成分支已提交版本建分支/worktree，生成并提交需求元数据及独立初始状态。创建前检查语义角色名在所有工作流和项目注册表中唯一。角色名只是实例名，不改变 Profile 角色定义。
5. 新需求从产品策划开始。旧批准仅作引用，不自动把新需求推进到实现。原单流程中进行到一半的需求不自动搬迁；先明确旧范围与新需求关系，记录采用边界。

`workstream.json` 的 `scope` 是已确认需求边界，`dependencies` 是需求 slug 列表。公共 API、数据库或组件变更由拥有该改动的需求在 `shared_changes` 记录 `{ "path": "src/api/...", "approval": "本需求内批准来源路径", "consumers": ["report"] }`，同步通知相关需求的交接/变更记录。依赖未批准时可继续无关工作，不能把缺失输入当作已批准约束。

## 会话、角色激活与恢复

- 每次专业写入会话先运行 `claim --id login --owner <可读窗口标签> --pid <仍存活的终端或 agent 进程 PID>`，保存返回的内部 token。PID 不能是立即退出的命令子进程；shell 中可用持久终端的 `$$`。token 不作用户可见角色名。
- 同一需求只允许一个持有写入租约的会话。所有专业 skill 必须遵守租约；它是协作约束，不能阻止不遵守协议的编辑器直接写文件。阶段守门器在同一会话内复用租约。退出或交接前 `release --id login --token <token>`。
- 同阶段角色激活由守门器核对授权后调用 `activate --project <需求 worktree> --role <Profile role> --agent <语义名> --token <token> --approval <来源>`。脚本串行校验全项目名称，更新本需求注册表与活动角色，不迁移阶段。迁移时保留会话租约，按原守门规则更新本需求状态/历史并重算产物路径；有新角色时仍经 `activate`，不能直接跳过名称检查。
- 项目级协调角色在集成分支 worktree 上经同一 `activate` 分配名称，不使用需求租约；阶段和授权按原项目守门规则检查。模型启动器同样使用解析后的作用域，需求任务不得从项目级状态启动。
- `list` 只读各分支和实际 worktree，区分已提交阶段与未提交进度，展示开放事项和交接入口。`resume --id login` 定位现有 worktree，缺失则从原分支重建，不接管旧租约。
- 窗口崩溃后先查租约 owner、host、PID 和 token；`recover --id login --token <旧 token>` 仅在同主机原进程已退出后移除租约。管理命令崩溃残留 `operation.lock` 时用 `recover --operation-lock --token <旧 token>`；存活或异地主机一律不自动抢锁。
- 本地 locator 丢失可从分支上的采用配置重建，多个目标有歧义时停止，不猜测。运行锁位于 Git 公共目录，因此所有本机 linked worktree 共享；本版本不提供跨 clone/远程协作锁。

## 需求验收与集成

需求的终止阶段沿用 Profile 的 `milestone-complete` ID，但作用域只表示本需求通过验收。它不宣布整个里程碑完成。

1. 守门器完成用户批准，检查所有必需产物、版本、范围、交接、依赖和阻塞项，将本需求推进到终止阶段。提交该范围内代码、文档、批准来源、状态与历史。
2. 在持有租约时运行 `accept --token <token> --approval <本需求内批准文件路径> --decision <批准 ID> --evidence '["本需求内验证报告路径"]'`。脚本检查终止状态、文件存在和无开放阻塞，为当前 HEAD 写入并提交 `workflow/acceptance.json`。它不替人解释批准或判定测试内容质量；真实批准仍由守门器核对。随后释放租约。
3. 任意窗口 `integrate --id login`。脚本检查干净需求 worktree、批准提交之后只增加验收收据、已批准公共改动及依赖同步；需求不得顺带覆盖项目级 `.planning` 或其他需求的产物。全局约束变更在其拥有的项目协调流程先批准/集成，再同步到需求。
4. 取得项目级集成槽，在临时 detached worktree 从最新目标提交执行非快进合并，需求历史保留。一次只处理一个集成候选；A 完成后 B 以最新目标准备。Git 冲突保留现场、释放槽；业务语义冲突返回责任角色。解决后提交候选并重新检查。
5. 按真实需求选择组合验证命令，在外部 JSON 文件写 argv 数组，例如 `[["npm","run","test:integration"],["npm","run","build"]]`，运行 `check --id login --checks <文件>`。命令在候选 worktree 执行，不使用隐式 shell；依赖安装按项目锁文件先完成。验证证据保存退出码、输出、命令和提交。严禁为过门选择无意义的恒真检查。
6. `finish --id login` 仅接受匹配当前候选提交的成功检查。将测试证据和来源提交写入需求自己的 `workflow/integration.json`，提交该行政记录，再更新目标：已检出的目标 worktree 必须干净，通过正常 Git 快进更新；未检出则带旧提交比较更新 ref。源或目标变化必须重新准备并验证，不能 force、reset、stash 用户改动。并发的非 agt Git 操作不受协作锁约束，集成期间不要手动移动目标分支。
7. 集成失败保留分支、候选、检查证据，目标不因检查失败而改变。`pause-integration --id login` 可释放待处理集成槽，记录仍可恢复；它不终止正在执行的管理命令。命令中断则先恢复进程锁。若更新目标后进程中断，以目标上的提交和收据为准，`list`/`cleanup` 可识别结果，不重复合并。

代码、需求状态及专业文档一起合并；两个需求位于不同目录。已存在的版本化配置和全局约束不会因 worktree 隔离自动实时同步，依赖方须合并集成分支并重验受影响内容。同步、修复或冲突处理改变已验收需求版本时，重新完成相应验收再生成收据。

最终的里程碑范围、遗留事项、跨需求回归和用户验收由项目级协调流程处理。集成操作只记事实，不自动改变项目阶段，不把需求验收、集成成功与里程碑完成混为一件事。

## 清理与恢复限制

`cleanup --id login` 只移除已完整集成、无未保存或忽略文件、无未合并提交、无写入租约的需求/集成 worktree，保留需求分支及所有正式记录。不能移除当前调用所在 worktree；从另一个项目 worktree 发起。构建缓存/本地环境文件先由用户或 agent 根据内容明确处理，不使用 `--force`、`clean` 或通配删除。

目标变动后重新准备会保留旧集成现场，避免删除其中可能有价值的冲突处理。旧现场在确认无未保存/未合并内容后用正常 `git worktree remove` 清理；不批量自动删除。运行测试输出可能包含产品信息，不把本地证据自动发送到外部系统。本功能不执行 push、发布、部署或远程 PR 合并。
