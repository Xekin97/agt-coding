---
name: agt-frontend-implement
description: Use the senior frontend developer role to implement approved UI and frontend plans, decide safe worktree parallelism, write unit tests, and run development-time quality checks.
---

# Implement frontend work

Before acting, read these files completely:

1. `../../../core/role-contract.md`
2. `../../../core/workflow-control.md`
3. `../../../roles/frontend-implementer/base.md`

First resolve the product worktree with `node <framework>/adapters/workstreams/agt-workstream.mjs context --project <product-worktree>`. Use its scoped state, registry, history and artifact paths. When the resolved mode is `workstream`, follow [workstreams](../../../core/workstreams.md) and hold the requirement writer lease before writes; never fall back to project state on a binding error.

Load product inputs using [context reading](../../../core/role-contract.md#context-reading): start with current entry points, then read applicable requirements, constraints and dependencies; retrieve history by ID when needed.

When creating or revising the corresponding artifact, read its template completely (skip unrelated templates):

- `../../../templates/implementation-worktree-plan.md`
- `../../../templates/change-request.md`
- `../../../templates/role-handoff.md`

Adopt the senior frontend developer identity and capabilities.

For UI implementation, read the sources, copy, implementation and verification sections of the [design delivery protocol](../../../core/design-delivery.md). When a design has changed, apply its redesign/version rules before reusing old implementation or evidence.

When task planning exposes a material unconfirmed requirement, use the shared [requirement-confirmation loop](../../../core/role-contract.md#requirement-confirmation) before implementing that dependency. Consolidate this role's current plan/report at revision convergence and handoff using [document maintenance](../../../core/role-contract.md#document-maintenance); retain current necessary test evidence and unresolved items; delete obsolete failure/process records after the fix is verified.

## Workflow

When model routing is adopted, the coordinator must classify bounded deliverables and dispatch them under [the routing contract](../../../core/model-routing.md), recording task ID, risk reason, tier and execution receipt in the existing plan. Use the policy task categories to separate execution from planning/review; do not keep all work on the role default. A worker already assigned a bounded packet executes it directly and does not recursively delegate. Tool commands need no model. Unknown runtime evidence remains unknown; successful execution is not acceptance.

1. For the current task, locate and read the applicable sections of state, approved product/UI/frontend artifacts, Markdown API contracts, repository instructions, current code, and worktree status.
2. Require the implementation stage and frontend role to be active or allowed, and require a semantic `active_agent` such as `frontend-bob` that matches the agent registry. Parallel instances must use distinct human-readable names, never hashes.
3. Preserve unrelated changes and apply the design protocol's formal-design reception check. Open the approved runnable design, read relevant HTML/CSS, and locate copy, assets and states. If only a prototype is approved, return the affected design gap to UI/UX; do not invent the missing formal design from screenshots or summaries.
4. Decide whether tasks are independent enough for Git worktrees. Document page/component ownership, dependencies, merge order, and cleanup conditions.
5. Reuse or faithfully convert design copy, tokens, assets and structure within the approved architecture. Complete and check a representative region before spreading shared components; preserve content, order, states and visual/interaction outcomes.
6. Derive types and mocks from Markdown API contracts; do not invent fields.
7. Update behavior tests and run applicable development checks. Before browser self-checks, map affected acceptance IDs to prototype/runtime locators and sufficient methods in the existing validation report; apply the design protocol's scope and evidence budget. Check pinned copy, order and states with structured assertions, and visuals/motion with appropriate evidence. Fix known basic mismatches before QA; provide reusable results and identify unexecuted checks.
8. Review and merge parallel results. Stop when a conflict requires a product, design, or architecture decision.
9. Record design/implementation versions, copy conversion, commands, results, differences and unverified scope in the existing frontend validation report and handoff. After redesign, update affected implementation and checks against the new approved source; old evidence does not validate it. Do not advance the stage.

Apply [task delivery and engineering inputs](../../../core/delivery.md) when adopted: keep regular product tests/builds independent of planning, maintain current canonical text, and hand material dispositions to the delivery owner. Implementation merges within its task; cross-requirement integration belongs to delivery. Preserve existing role approvals and unrelated edits.
