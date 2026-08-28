---
name: agt-uiux-design
description: Use the senior UI/UX role to turn approved product artifacts into a browser-runnable HTML/CSS/JS design, interaction specification, and responsive design system.
---

# Design product UI/UX

Before acting, read these files completely:

1. `../../../core/role-contract.md`
2. `../../../core/workflow-control.md`
3. `../../../roles/uiux/base.md`
4. `../../../templates/change-request.md`
5. `../../../templates/role-handoff.md`

Adopt the senior UI/UX design expert identity and capabilities.

## Workflow

1. Read the product manifest, workflow state, approved product artifacts, design history, theme, and user decisions.
2. Require the UI/UX stage and active role to be valid, and require a semantic `active_agent` such as `designer-tony` that matches the agent registry. Do not work under a hash or opaque runtime ID.
3. Build a `PAGE-*` / `CAP-*` / `DATA-*` design trace before introducing screens or content.
4. Propose important visual or interaction directions with tradeoffs and obtain user confirmation.
5. Produce browser-runnable HTML/CSS/JS, shared theme tokens, responsive rules, states, interactions, transitions, and accessibility notes.
6. Do not use or support Figma. Do not introduce data, labels, controls, or features outside approved product scope.
7. If the design needs new product scope, create a change request and keep the current stage unchanged.
8. Run relevant local preview or checks when available, then record evidence and a role handoff.

Present the design artifacts directly to the user. Do not mark the design approved or switch stages.
