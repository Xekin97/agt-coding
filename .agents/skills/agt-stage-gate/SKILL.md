---
name: agt-stage-gate
description: Handle an explicit agt-coding role activation, stage submission, approval, transition, recovery, or rollback without summarizing or replacing specialist work.
---

# Run the explicit stage gate

Use this Skill only when the user explicitly requests role activation or switching, stage submission, approval, transition, recovery, or rollback.

A bounded fix or small enhancement can use the adopted [Quick workflow](../../../core/quick-tasks.md) without a milestone transition. Do not force role activation or a new milestone solely because the current milestone is complete. Quick status belongs to its task record; this gate continues to own milestone transitions.

Before acting, read these files completely:

1. `../../../core/role-contract.md`
2. `../../../core/workflow-control.md`
3. `../../../roles/gatekeeper/ROLE.md`

First resolve the product worktree with `node <framework>/adapters/workstreams/agt-workstream.mjs context --project <product-worktree>`. Use its scoped state, registry, history and artifact paths. When the resolved mode is `workstream`, follow [workstreams](../../../core/workstreams.md) and hold the requirement writer lease before writes; never fall back to project state on a binding error.

Load product inputs using [context reading](../../../core/role-contract.md#context-reading): start with current entry points, then read applicable requirements, constraints and dependencies; retrieve history by ID when needed.

Run `validators/validate-agent-name.sh <name>` from the framework root when validating a name; read its source only when diagnosing a failure.

When creating or revising the corresponding artifact, read its template completely (skip unrelated templates):

- `../../../templates/stage-review.md`

Adopt the stage gate expert identity and stay within its narrow output authority.

Check the specialist's [requirement-confirmation record](../../../core/role-contract.md#requirement-confirmation), [authorization scope](../../../core/workflow-control.md#authorization-scope) and [current document entry points](../../../core/role-contract.md#document-maintenance); missing closure goes back to its owner. Consolidate your own mutable review drafts; retain approvals/history and reuse already-explicit authorization.

## Operation modes

In opted-in workstream mode, use the [workstream protocol](../../../core/workstreams.md): reuse the current writer lease; route role activation through the shared-lock `activate` command; update only the resolved state/history and resolve required artifacts for the target stage. A terminal stage completes this requirement only. After scoped user acceptance, commit the approved deliverables/state/history, then run `accept` with the approval source, decision ID and evidence paths to bind the receipt to that version. Do not run integration checks or declare the whole milestone complete here.

- `activate-role`: keep the current stage, confirm the requested role is allowed, validate or assign its semantic name, then update only the agent registry, `active_role`, and `active_agent`.
- `transition-stage`: run the full artifact gate before changing stage.
- `recover-or-rollback`: restore or move state using recorded history without silently changing approved artifacts.

Never combine role activation with a stage transition unless the user explicitly requested the exact transition and its gate passes.

## Workflow

1. Read the project manifest/Profile, agent registry, current state, allowed transitions and latest handoff. Check all required artifact entries and open-item indexes; read applicable decisions, changes and authorization records. Retrieve the last transition or rollback history by ID only when needed, not the entire history file.
2. Display the current milestone, stage, semantic `active_agent`, active role, status, and direct links to original specialist artifacts. Never display an opaque runtime ID as the role name.
3. For `activate-role`, check that the role belongs to the locked Profile and is allowed in the current stage. For stage operations, check required artifacts, declared completeness, blockers, changes, traceability and verification evidence; for UI delivery, check purpose/version and approval against the design protocol, not just file existence.
4. Do not rewrite specialist artifacts, perform code semantic review, or mechanically rerun developer unit/lint checks.
5. If any blocking condition fails, report the exact missing item and leave state unchanged.
6. If conditions pass, show the single proposed target transition and ask for final user confirmation unless it was already unambiguously provided for that exact transition.
7. Update state and history only within the verified authorization scope. Continuous execution still checks each transition; a scoped acceptance or terminal state does not authorize milestone closeout or a new milestone.
8. Before activating any role, require or assign a unique semantic display name, validate it with `validators/validate-agent-name.sh`, check registry uniqueness, record it in the agent registry and state, and map it to a restricted runtime name only when Codex requires it.
9. Report the next active role with its semantic name and stop; do not perform that role's professional work.
