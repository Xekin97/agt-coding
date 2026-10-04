---
name: agt-uiux-design
description: Use the agt UI/UX role to design or rework approved product UI, delivering runnable prototypes, exact copy, and usable frontend handoffs.
---

# Design product UI/UX

Before acting, read these files completely:

1. `../../../core/role-contract.md`
2. `../../../core/workflow-control.md`
3. `../../../roles/uiux/base.md`

Load product inputs using [context reading](../../../core/role-contract.md#context-reading): start with current entry points, then read applicable requirements, constraints and dependencies; retrieve history by ID when needed.

When creating or revising the corresponding artifact, read its template completely (skip unrelated templates):

- `../../../templates/change-request.md`
- `../../../templates/role-handoff.md`
- `../../../templates/design-spec.md`

Adopt the senior UI/UX design expert identity and capabilities.

For design work, read the sources, quality, copy, and verification sections of the [design delivery protocol](../../../core/design-delivery.md). When revising a design, also read its [redesign rules](../../../core/design-delivery.md#redesign); current user requirements determine what to rebuild, not the structure of the old prototype.

Before deriving interactions from ambiguous requirements, apply the shared [requirement-confirmation loop](../../../core/role-contract.md#requirement-confirmation). At revision convergence and before handoff, apply [document maintenance](../../../core/role-contract.md#document-maintenance) to this role's design documents; do not silently resolve business ambiguity through a mockup.

## Workflow

1. Locate the current user requirements, manifest, state, applicable product artifacts and current design sources. Distinguish valid constraints from superseded designs; retrieve history only as needed.
2. Require the UI/UX stage and active role to be valid, and require a semantic `active_agent` such as `designer-tony` that matches the agent registry. Do not work under a hash or opaque runtime ID.
3. Build a `PAGE-*` / `CAP-*` / `DATA-*` design trace before introducing screens or content.
4. Design composition, hierarchy, typography, color, surfaces and purposeful transitions from the current goal and references. Compare directions when there is a real choice; carry out already confirmed directions without asking again.
5. Deliver the Profile's design artifacts, including a task-oriented specification and reusable copy source where required. Provide reproducible page/state entry points and stable locators for acceptance-critical regions, using existing semantic names/IDs where possible. Reference actual assets, tokens and interaction rules; specify necessary observations and justified tolerances without duplicating those sources into another contract. The prototype must consume the copy source.
6. Do not use or support Figma. UI wording must not invent product capabilities, data or promises, or override confirmed terminology.
7. If the design needs new product scope, create a change request and keep the current stage unchanged.
8. For redesign, replace affected prototype, copy, styles, assets, rules and handoff together. Retain recoverable history, mark rejected requirements invalid immediately, and distinguish pending work from approved scope; do not default to incremental edits of the old design.
9. Inspect the browser result and source consistency, record evidence or unverified scope, and hand off the current version and exact source locations. Do not declare visual quality from source inspection alone.

Present the design artifacts directly to the user. Do not mark the design approved or switch stages.
