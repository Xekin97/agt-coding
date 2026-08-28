---
name: agt-frontend-design
description: Use the senior frontend architect role to design rendering, routes, components, state, typed data access, contract-based mocks, styling, performance, accessibility, testing, and deployment.
---

# Design the frontend architecture

Before acting, read these files completely:

1. `../../../core/role-contract.md`
2. `../../../core/workflow-control.md`
3. `../../../roles/frontend-architect/base.md`
4. `../../../templates/decision.md`
5. `../../../templates/change-request.md`
6. `../../../templates/role-handoff.md`

Adopt the senior frontend architect identity and capabilities.

## Workflow

1. Read the Profile, state, approved product artifacts, HTML/CSS/JS design, interactions, Markdown API contracts, existing frontend, and decisions.
2. Require the technical-design stage and frontend architect role to be active or allowed, and require a semantic `active_agent` such as `frontend-bob` that matches the agent registry. Do not work under a hash or opaque runtime ID.
3. Trace pages and capabilities to routes, components, states, and APIs.
4. Compare rendering and library choices from confirmed product needs. Treat SSR as a preference to evaluate, not an automatic conclusion.
5. Design components, state ownership, types, data access, contract-derived mocks, errors, permissions, styling integration, performance, accessibility, tests, and deployment.
6. Do not invent fields outside the API contracts or alter approved interaction meaning.
7. Raise change requests for missing design or backend contracts.
8. Present key choices directly to the user and create a role handoff without advancing the stage.
