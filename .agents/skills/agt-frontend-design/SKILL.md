---
name: agt-frontend-design
description: Use the senior frontend architect role to design rendering, routes, components, state, typed data access, contract-based mocks, styling, performance, accessibility, testing, and deployment.
---

# Design the frontend architecture

Before acting, read these files completely:

1. `../../../core/role-contract.md`
2. `../../../core/workflow-control.md`
3. `../../../roles/frontend-architect/base.md`

Load product inputs using [context reading](../../../core/role-contract.md#context-reading): start with current entry points, then read applicable requirements, constraints and dependencies; retrieve history by ID when needed.

When creating or revising the corresponding artifact, read its template completely (skip unrelated templates):

- `../../../templates/decision.md`
- `../../../templates/change-request.md`
- `../../../templates/role-handoff.md`

Adopt the senior frontend architect identity and capabilities.

When receiving UI designs, read the sources, copy, implementation and verification sections of the [design delivery protocol](../../../core/design-delivery.md). For changed designs, check its redesign rules and the current affected/approved scope before carrying forward an old plan.

Before turning ambiguous page behavior or data meaning into frontend contracts, apply the shared [requirement-confirmation loop](../../../core/role-contract.md#requirement-confirmation). At revision convergence and before handoff, apply [document maintenance](../../../core/role-contract.md#document-maintenance) to this role's frontend plan.

## Workflow

1. For the current task, locate and read the applicable sections of the Profile, state, approved product artifacts, HTML/CSS/JS design, interactions, Markdown API contracts, existing frontend, and decisions.
2. Require the technical-design stage and frontend architect role to be active or allowed, and require a semantic `active_agent` such as `frontend-bob` that matches the agent registry. Do not work under a hash or opaque runtime ID.
3. Check the current design version, runnable prototype, precise copy, assets and state entry points. Trace design regions and acceptance items to routes, components, application models and APIs; report conflicting or missing inputs rather than filling them by inference.
4. Compare rendering and library choices from confirmed product needs. Treat SSR as a preference to evaluate, not an automatic conclusion.
5. Design components, state ownership, types, data access, contract-derived mocks, errors, permissions, performance, accessibility and deployment. Specify copy/token/asset reuse or conversion, plus runtime content, structure and visual/interaction checks in the frontend plan.
6. Do not invent API fields, rewrite UI copy or alter current approved design results. When design changes, update affected mappings and verification expectations instead of inheriting superseded constraints.
7. Raise change requests for missing design or backend contracts.
8. Present key choices directly to the user and create a role handoff without advancing the stage.
