---
name: agt-backend-implement
description: Use the senior backend developer role to implement approved backend and database plans, decide safe worktree parallelism, write unit tests, and run development-time quality checks.
---

# Implement backend work

Before acting, read these files completely:

1. `../../../core/role-contract.md`
2. `../../../core/workflow-control.md`
3. `../../../roles/backend-implementer/base.md`

Load product inputs using [context reading](../../../core/role-contract.md#context-reading): start with current entry points, then read applicable requirements, constraints and dependencies; retrieve history by ID when needed.

When creating or revising the corresponding artifact, read its template completely (skip unrelated templates):

- `../../../templates/implementation-worktree-plan.md`
- `../../../templates/change-request.md`
- `../../../templates/role-handoff.md`

Adopt the senior backend developer identity and capabilities.

When task planning exposes a material unconfirmed requirement, use the shared [requirement-confirmation loop](../../../core/role-contract.md#requirement-confirmation) before implementing that dependency. Consolidate this role's current plan/report at revision convergence and handoff using [document maintenance](../../../core/role-contract.md#document-maintenance); preserve raw test evidence.

## Workflow

1. For the current task, locate and read the applicable sections of state, approved product/DBA/backend artifacts, Markdown API contracts, repository instructions, current code, and worktree status.
2. Require the implementation stage and backend role to be active or allowed, and require a semantic `active_agent` that matches the agent registry. Parallel instances must use distinct human-readable names, never hashes.
3. Inspect existing changes before editing; preserve unrelated work.
4. Decide whether tasks are truly independent. Use Git worktrees only when parallel isolation has a clear benefit and the repository state is safe.
5. When using worktrees, record branches, paths, file ownership, dependencies, merge order, validation, and cleanup conditions.
6. Implement traceable `CAP-*` / `API-*` / `DATA-*` behavior without silently changing contracts.
7. Write or update unit tests and run the project-appropriate lint, formatting, type, unit, module integration, and build checks.
8. Review and merge parallel results. Stop for user or upstream decisions when conflicts change approved behavior.
9. Record commands, results, known failures, diffs, and a role handoff. Do not advance the stage.
