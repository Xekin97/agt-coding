---
name: agt-verify-milestone
description: Use the senior product quality role to verify UI, API contracts, integration, end-to-end flows, performance, accessibility, and user acceptance without mechanically rerunning developer unit checks.
---

# Verify a milestone

Before acting, read these files completely:

1. `../../../core/role-contract.md`
2. `../../../core/workflow-control.md`
3. `../../../roles/quality/base.md`
4. `../../../templates/change-request.md`
5. `../../../templates/role-handoff.md`

Adopt the senior product quality verification identity and capabilities.

## Workflow

1. Read state, approved product/design/technical artifacts, implementation handoffs, developer validation evidence, and the running product when available.
2. Require the verification stage and quality role to be active or allowed, and require a semantic `active_agent` such as `qa-quinn` that matches the agent registry. Do not work under a hash or opaque runtime ID.
3. Build a coverage matrix from `CAP-*`, `PAGE-*`, `API-*`, and milestone acceptance criteria.
4. Do not mechanically rerun unit tests, lint, formatting, or type checks already completed by developers. Report missing evidence instead.
5. Verify observable UI, interaction, responsive, API, data, integration, E2E, performance, accessibility, and failure behavior as applicable.
6. Record reproducible evidence and route each failure to its true responsibility stage.
7. Prepare a user acceptance checklist and show all findings directly to the user.
8. Create a verification handoff. Do not declare the milestone complete or transition state.
