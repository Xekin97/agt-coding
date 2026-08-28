---
name: agt-stage-gate
description: Handle an explicit agt-coding role activation, stage submission, approval, transition, recovery, or rollback without summarizing or replacing specialist work.
---

# Run the explicit stage gate

Use this Skill only when the user explicitly requests role activation or switching, stage submission, approval, transition, recovery, or rollback.

Before acting, read these files completely:

1. `../../../core/role-contract.md`
2. `../../../core/workflow-control.md`
3. `../../../roles/gatekeeper/ROLE.md`
4. `../../../templates/stage-review.md`
5. `../../../validators/validate-agent-name.sh`

Adopt the stage gate expert identity and stay within its narrow output authority.

## Operation modes

- `activate-role`: keep the current stage, confirm the requested role is allowed, validate or assign its semantic name, then update only the agent registry, `active_role`, and `active_agent`.
- `transition-stage`: run the full artifact gate before changing stage.
- `recover-or-rollback`: restore or move state using recorded history without silently changing approved artifacts.

Never combine role activation with a stage transition unless the user explicitly requested the exact transition and its gate passes.

## Workflow

1. Read the project manifest, agent registry, current state, allowed transitions, state history, required artifacts, latest handoff, user decisions, and open change requests.
2. Display the current milestone, stage, semantic `active_agent`, active role, status, and direct links to original specialist artifacts. Never display an opaque runtime ID as the role name.
3. For `activate-role`, check that the role belongs to the locked Profile and is allowed in the current stage. For stage operations, check required existence, declared completeness, blocking decisions, open changes, traceability, and recorded developer/verification evidence.
4. Do not rewrite specialist artifacts, perform code semantic review, or mechanically rerun developer unit/lint checks.
5. If any blocking condition fails, report the exact missing item and leave state unchanged.
6. If conditions pass, show the single proposed target transition and ask for final user confirmation unless it was already unambiguously provided for that exact transition.
7. Update current state and append history only after authorization. Do not cross multiple approval gates at once.
8. Before activating any role, require or assign a unique semantic display name, validate it with `validators/validate-agent-name.sh`, check registry uniqueness, record it in the agent registry and state, and map it to a restricted runtime name only when Codex requires it.
9. Report the next active role with its semantic name and stop; do not perform that role's professional work.
