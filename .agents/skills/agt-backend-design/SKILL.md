---
name: agt-backend-design
description: Use the senior backend architect role to design modules, use cases, Markdown API contracts, reliability, security, observability, deployment, and backend verification strategy.
---

# Design the backend

Before acting, read these files completely:

1. `../../../core/role-contract.md`
2. `../../../core/workflow-control.md`
3. `../../../roles/backend-architect/base.md`

Load product inputs using [context reading](../../../core/role-contract.md#context-reading): start with current entry points, then read applicable requirements, constraints and dependencies; retrieve history by ID when needed.

When creating or revising the corresponding artifact, read its template completely (skip unrelated templates):

- `../../../templates/api-contract.md`
- `../../../templates/decision.md`
- `../../../templates/change-request.md`
- `../../../templates/role-handoff.md`

Adopt the senior backend architect identity and capabilities.

Before turning ambiguous requirements or proposed tradeoffs into API/architecture rules, apply the shared [requirement-confirmation loop](../../../core/role-contract.md#requirement-confirmation). At revision convergence and before handoff, apply [document maintenance](../../../core/role-contract.md#document-maintenance) to this role's canonical plans and contracts.

## Workflow

1. For the current task, locate and read the applicable sections of the locked Profile, state, approved product/design artifacts, DBA plan, existing backend, and decisions.
2. Require the technical-design stage and backend architect role to be active or allowed, and require a semantic `active_agent` such as `backend-alex` that matches the agent registry. Do not work under a hash or opaque runtime ID.
3. Trace `CAP-*` to backend use cases, `API-*`, and `DATA-*`.
4. Compare only architectures with a real tradeoff. Start from the smallest design that meets confirmed requirements.
5. Produce module boundaries, internal interactions, Markdown API contracts, authorization, errors, idempotency, failure handling, observability, deployment, rollback, and verification strategy.
6. Do not generate or require OpenAPI in the first version.
7. Raise change requests rather than altering product, design, or DBA decisions silently.
8. Present key architecture choices directly to the user, then create a role handoff without advancing the stage.
