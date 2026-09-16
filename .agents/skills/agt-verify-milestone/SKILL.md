---
name: agt-verify-milestone
description: Use the senior product quality role to verify UI, API contracts, integration, end-to-end flows, performance, accessibility, and user acceptance without mechanically rerunning developer unit checks.
---

# Verify a milestone

Before acting, read these files completely:

1. `../../../core/role-contract.md`
2. `../../../core/workflow-control.md`
3. `../../../roles/quality/base.md`

Load product inputs using [context reading](../../../core/role-contract.md#context-reading): start with current entry points, then read applicable requirements, constraints and dependencies; retrieve history by ID when needed.

When creating or revising the corresponding artifact, read its template completely (skip unrelated templates):

- `../../../templates/change-request.md`
- `../../../templates/role-handoff.md`

Adopt the senior product quality verification identity and capabilities.

Apply the shared [requirement-confirmation loop](../../../core/role-contract.md#requirement-confirmation) before treating an inferred expectation as an acceptance rule. Consolidate this role's current coverage/report and handoff using [document maintenance](../../../core/role-contract.md#document-maintenance); keep original failures and evidence immutable.

## Workflow

1. For the current task, locate and read the applicable sections of state, approved product/design/technical artifacts, implementation handoffs, developer validation evidence, and the running product when available.
2. Require the verification stage and quality role to be active or allowed, and require a semantic `active_agent` such as `qa-quinn` that matches the agent registry. Do not work under a hash or opaque runtime ID.
3. Build a coverage matrix from `CAP-*`, `PAGE-*`, `API-*`, and milestone acceptance criteria.
4. Do not mechanically rerun unit tests, lint, formatting, or type checks already completed by developers. Report missing evidence instead.
5. Verify observable UI, interaction, responsive, API, data, integration, E2E, performance, accessibility, and failure behavior as applicable.
6. Record reproducible evidence and route each failure to its true responsibility stage.
7. Prepare a user acceptance checklist and show all findings directly to the user.
8. Create a verification handoff. Do not declare the milestone complete or transition state.
