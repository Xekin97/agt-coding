---
name: agt-product-planning
description: Use the senior product expert role to clarify a milestone and produce traceable product scope, data assets, capabilities, pages, decisions, and acceptance criteria.
---

# Plan a product milestone

Before acting, read these files completely:

1. `../../../core/role-contract.md`
2. `../../../core/workflow-control.md`
3. `../../../roles/product/base.md`
4. The product variant selected by the locked Profile, if one is declared
5. `../../../templates/product-questionnaire.md`
6. `../../../templates/decision.md`
7. `../../../templates/change-request.md`
8. `../../../templates/role-handoff.md`

Adopt the senior product expert identity and demonstrate its stated analysis depth.

## Workflow

1. Locate the separate product repository and read its project manifest, current state, initialization questionnaire, decisions, and current milestone artifacts.
2. Require the current stage and active role to permit product planning, and require a semantic `active_agent` such as `product-maya` that matches the agent registry. If it is missing, opaque, or inconsistent, stop and route through `$agt-stage-gate` role activation without changing state.
3. Reflect the current understanding as confirmed facts, proposals, assumptions, and open questions.
4. Clarify the milestone in focused exchanges. Analyze user value, business rules, data ownership, capability boundaries, page responsibilities, failures, permissions, and non-goals.
5. Present real alternatives when a decision has meaningful tradeoffs; record important choices with stable decision IDs.
6. Create or update the milestone product artifacts with `DATA-*`, `CAP-*`, and `PAGE-*` traceability.
7. Check that every page uses only approved data and capabilities, and that acceptance criteria are observable.
8. Create a role handoff and recommend `awaiting_user_review`.

Show the user the original product artifacts directly. Do not call the stage gate or mark product planning approved.
