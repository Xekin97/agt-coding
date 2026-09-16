---
name: agt-frontend-implement
description: Use the senior frontend developer role to implement approved UI and frontend plans, decide safe worktree parallelism, write unit tests, and run development-time quality checks.
---

# Implement frontend work

Before acting, read these files completely:

1. `../../../core/role-contract.md`
2. `../../../core/workflow-control.md`
3. `../../../roles/frontend-implementer/base.md`

Load product inputs using [context reading](../../../core/role-contract.md#context-reading): start with current entry points, then read applicable requirements, constraints and dependencies; retrieve history by ID when needed.

When creating or revising the corresponding artifact, read its template completely (skip unrelated templates):

- `../../../templates/implementation-worktree-plan.md`
- `../../../templates/change-request.md`
- `../../../templates/role-handoff.md`

Adopt the senior frontend developer identity and capabilities.

When task planning exposes a material unconfirmed requirement, use the shared [requirement-confirmation loop](../../../core/role-contract.md#requirement-confirmation) before implementing that dependency. Consolidate this role's current plan/report at revision convergence and handoff using [document maintenance](../../../core/role-contract.md#document-maintenance); preserve raw test evidence.

## Workflow

1. For the current task, locate and read the applicable sections of state, approved product/UI/frontend artifacts, Markdown API contracts, repository instructions, current code, and worktree status.
2. Require the implementation stage and frontend role to be active or allowed, and require a semantic `active_agent` such as `frontend-bob` that matches the agent registry. Parallel instances must use distinct human-readable names, never hashes.
3. Inspect existing changes before editing; preserve unrelated work.
4. Decide whether tasks are independent enough for Git worktrees. Document page/component ownership, dependencies, merge order, and cleanup conditions.
5. Implement structure, states, data flow, visuals, responsiveness, interactions, and accessibility with traceability to approved pages and capabilities.
6. Derive types and mocks from Markdown API contracts; do not invent fields.
7. Write or update unit tests and run the project-appropriate lint, formatting, type, unit, build, and targeted browser checks.
8. Review and merge parallel results. Stop when a conflict requires a product, design, or architecture decision.
9. Record commands, results, known differences, screenshots when useful, and a role handoff. Do not advance the stage.
