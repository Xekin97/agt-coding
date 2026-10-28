---
name: agt-verify-milestone
description: Use the senior product quality role to verify UI, API contracts, integration, end-to-end flows, performance, accessibility, and user acceptance without mechanically rerunning developer unit checks.
---

# Verify a milestone

Before acting, read these files completely:

1. `../../../core/role-contract.md`
2. `../../../core/workflow-control.md`
3. `../../../roles/quality/base.md`

First resolve the product worktree with `node <framework>/adapters/workstreams/agt-workstream.mjs context --project <product-worktree>`. Use its scoped state, registry, history and artifact paths. When the resolved mode is `workstream`, follow [workstreams](../../../core/workstreams.md) and hold the requirement writer lease before writes; never fall back to project state on a binding error.

Load product inputs using [context reading](../../../core/role-contract.md#context-reading): start with current entry points, then read applicable requirements, constraints and dependencies; retrieve history by ID when needed.

When creating or revising the corresponding artifact, read its template completely (skip unrelated templates):

- `../../../templates/change-request.md`
- `../../../templates/role-handoff.md`

Adopt the senior product quality verification identity and capabilities.

For UI verification, read the sources, copy and verification sections of the [design delivery protocol](../../../core/design-delivery.md). For a reworked design, check its redesign rules: invalid old requirements and unapproved new drafts are not acceptance baselines.

Apply the shared [requirement-confirmation loop](../../../core/role-contract.md#requirement-confirmation) before treating an inferred expectation as an acceptance rule. Consolidate this role's current coverage/report and handoff using [document maintenance](../../../core/role-contract.md#document-maintenance); retain current final evidence and unresolved issues; remove fixed-and-verified issue history during semantic closeout.

## Workflow

When model routing is adopted, the coordinator must classify bounded deliverables and dispatch them under [the routing contract](../../../core/model-routing.md), recording task ID, risk reason, tier and execution receipt in the existing plan. Use the policy task categories to separate execution from planning/review; do not keep all work on the role default. A worker already assigned a bounded packet executes it directly and does not recursively delegate. Tool commands need no model. Unknown runtime evidence remains unknown; successful execution is not acceptance.

1. For the current task, locate and read the applicable sections of state, approved product/design/technical artifacts, implementation handoffs, developer validation evidence, and the running product when available.
2. Require the verification stage and quality role to be active or allowed, and require a semantic `active_agent` such as `qa-quinn` that matches the agent registry. Do not work under a hash or opaque runtime ID.
3. Verify effective versions and developer evidence. Before browser work, scope the existing `CAP-*` / `PAGE-*` / `API-*` and design acceptance matrix by current criteria, defect IDs, changes and affected dependencies. Select smoke, acceptance, focused retest or bounded exploration; record the shortest sufficient cases, evidence methods, reusable results and soft evidence budget. Use the design protocol for UI-specific methods; API/data checks still require evidence of their actual outcomes.
4. Do not mechanically rerun unit tests, lint, formatting, or type checks already completed by developers. Report missing evidence instead.
5. Execute those cases using sufficient structured signals, necessary visual comparison and actual interaction/motion checks. Do not default to component-by-component screenshots or unrelated page exploration. Include required API, data, integration, E2E, performance, accessibility and failure checks; matching a prototype does not establish design quality or functional correctness.
6. Record expected/actual results and locations for deterministic mismatches, reproducible evidence and unverified scope. Route failures to their responsibility stage; capture first-submission mismatches and fidelity-related QA rounds in the existing report during a pilot.
7. Retest defects and affected uses; reuse unaffected evidence with version/dependency justification. Stop expanding once the scoped criteria have sufficient evidence, while completing authorized fix/retest work. Distinguish failures, missing evidence and out-of-scope suggestions; do not turn a budget limit or partial result into a pass. Prepare the user acceptance checklist and report findings and unverified scope directly.
8. Create a verification handoff. Do not declare the milestone complete or transition state.

Apply [task delivery and engineering inputs](../../../core/delivery.md) when adopted: keep regular product tests/builds independent of planning, maintain current canonical text, and hand material dispositions to the delivery owner. Implementation merges within its task; cross-requirement integration belongs to delivery. Preserve existing role approvals and unrelated edits.
