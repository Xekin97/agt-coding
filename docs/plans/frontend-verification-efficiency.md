# 前端验证执行优化

- 日期：2026-09-29。
- 状态：规则与模板已接入；受控方法试点已执行；独立 agent 行为与整体成本效果尚未验证。
- 授权：用户在阅读方案后要求“按你的来优化吧”。参考[分享对话](https://chatgpt.com/share/6abb1973-b2b4-83ea-bd1e-f4c783a2ff77)，结合现有契约取舍，不直接复制其统一阈值和绝对跳过规则。
- 范围：基座规则维护，保留本轮前已有的工作区修改；没有新增角色、必需产物、Profile 版本或自动运行平台，没有改产品代码、状态、冻结证据及锁。

## 已完成改动

| ID | 改动与真源 | 完成结果 |
|---|---|---|
| FVE-01 | [设计交付协议§5](../../core/design-delivery.md#verification) | 明确冒烟/验收/定向复验/有界探索，先确定充分证据；结构化断言、视觉对照与实际动效各自证明适用结果；软预算、证据去重、相关复验及收尾条件集中维护 |
| FVE-02 | [QA角色](../../roles/quality/base.md)、[QA Skill](../../.agents/skills/agt-verify-milestone/SKILL.md)、[前端 Skill](../../.agents/skills/agt-frontend-implement/SKILL.md)、[设计 Skill](../../.agents/skills/agt-uiux-design/SKILL.md) | 把检查方法接入现有执行步骤，角色入口只提示职责和协议，不另存同一套细则 |
| FVE-03 | [设计规格](../../templates/design-spec.md)、[交接单](../../templates/role-handoff.md) | 补关键区域定位、必要观察/容差来源、充分证据和复用/剩余范围；原型与实现允许不同DOM，不强制另建JSON契约或逐节点属性 |
| FVE-04 | [文档维护§2](../../core/document-maintenance.md#2-核实事项与证据)、[使用说明](../../README.md) | 局部交付围绕当前清单和相关依赖核对，复用冻结基线，避免每次重扫整个历史；保留既有正式校验和证据完整性要求 |

这些是角色执行规则，不是拦截浏览器操作、统计计费或强制预算的运行时服务。普通验收默认无需送图不能扩展为禁止视觉判断；预算不足不能把必需未验项写成通过。流程权限及最终用户验收归属保持。

## 方法试点

复用一个现有产品已保存的修复前/后生产构建、批准原型及契约mock，在独立loopback端口回放已有失败。采用同一套断言检查前后版本，不改期望取得通过；没有重建或重跑产品开发检查，未接入真实提供方。它检验检查方法是否适用于这些失败，不是一次独立agent盲测。

| 检查对象 | 原问题构建 | 修复构建 | 证据方法 |
|---|---|---|---|
| 原生选择器最小高度 | 检出不满足既有规范 | 通过 | WebKit390px实际尺寸+选项值 |
| 平板大数值标题行 | 检出页面横溢 | 通过 | Chromium768px页面边界+完整数值 |
| 领取后焦点 | 检出未回对应展开摘要 | 通过 | WebKit390px实际领取+activeElement+展开状态 |
| 列表离开再返回 | 检出筛选丢失 | 通过 | Chromium1440px实际SPA导航+选中态/条目/链接 |
| 轮播计时与系统动效偏好 | 本试点不追加旧版检查 | 通过 | 实际等待完整8秒，连续采样状态，6次偏好切换；未用截图代替过程 |

四个已知缺陷全部检出，四个修复场景全部通过；检查方法错误0，页面脚本错误0。9个行为场景保存截图0、送模图片0。导航视觉小样采用同一环境的批准原型截图作为基线，当前实现一致；临时注入颜色变化后检出94个不同像素。该校准样本的零差异条件不作为产品全局容差。视觉对照共保存4个PNG原件，没有交给模型看图。

自动化试点总耗时20.2秒，含本地服务启动/清理，不含既有构建或历史测试。独立端口均释放，没有改动用户原预览。未执行完整旧方法的同范围耗时对照，也没有usage记录；tokens/费用未知，不宣称总体节省比例、全产品缺陷检出率或agent执行效果提升。

本机原件（临时运行目录，不作为跨机器可用的交付依赖）：

- [输入、构建摘要与方法](/var/folders/z9/99ckxr957v901zwwc8jdk8640000gn/T/agt-verification-update-zm0pd14c/pilot/inputs.json)
- [行为结果](/var/folders/z9/99ckxr957v901zwwc8jdk8640000gn/T/agt-verification-update-zm0pd14c/pilot/behavior-results.json)、[概要](/var/folders/z9/99ckxr957v901zwwc8jdk8640000gn/T/agt-verification-update-zm0pd14c/pilot/summary.json)
- [视觉结果](/var/folders/z9/99ckxr957v901zwwc8jdk8640000gn/T/agt-verification-update-zm0pd14c/pilot/visual-results.json)、[运行及清理](/var/folders/z9/99ckxr957v901zwwc8jdk8640000gn/T/agt-verification-update-zm0pd14c/pilot/runtime.json)
- 复现脚本在同目录`run.py`、`behavior.mjs`和`visual.spec.cjs`；需要原产品构建与浏览器依赖，仅用于本次本地实验。

## 基座检查与读取成本

三份修改后的Skill通过skill-creator格式校验；现有consumer-ai-web@2.0.0通过Profile校验，必需路径与版本未改。改动文件的链接/锚点、围栏、增量差异及空白检查完成；未增加匹配Prompt措辞的单元测试或运行无关模型路由测试。

入口大小按相同文件的Unicode字符数计量，非token或实际累计输入：

| 文件 | 修改前 | 修改后 |
|---|---:|---:|
| `core/design-delivery.md` | 3993 | 5915 |
| `roles/quality/base.md` | 1287 | 1344 |
| `.agents/skills/agt-verify-milestone/SKILL.md` | 3085 | 3811 |
| `.agents/skills/agt-frontend-implement/SKILL.md` | 3555 | 3721 |
| `.agents/skills/agt-uiux-design/SKILL.md` | 3476 | 3663 |

共享协议增加了方法细节，不能据此宣称默认输入减少。后续实际使用应观察总读取量、送模图片、误报/漏报、返工与耗时，必要时删除未产生实际价值的规则；试点日志不加入角色默认必读。已有产品继续使用其锁定版本，基座修改不自动迁移产品。
