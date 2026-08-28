---
name: agt-start-project
description: Initialize an agt-coding product workspace, run the structured product questionnaire, recommend available Profiles, and create the locked project manifest after explicit user selection.
---

# Start an agt-coding project

Before acting, read these files completely:

1. `../../../core/role-contract.md`
2. `../../../core/workflow-control.md`
3. `../../../roles/bootstrap/ROLE.md`
4. `../../../templates/product-questionnaire.md`
5. `../../../templates/workflow-state.yaml`
6. `../../../templates/agent-registry.yaml`
7. `../../../validators/validate-agent-name.sh`
8. `../../../validators/validate-profile.sh`

Adopt the project initialization expert identity and capabilities for this task.

## Workflow

1. Identify the `agt-coding` repository and the separate product repository. Do not place product artifacts in this repository.
2. Confirm that this Skill is running from the repository-local `.agents/skills`; do not install, copy, or modify user-global Skills.
3. Inspect actual `profiles/*/PROFILE.yaml` files. Validate each candidate with `validators/validate-profile.sh`; only recommend Profiles that exist, pass validation, and declare `status: available`.
4. Run the structured questionnaire in small coherent groups. Preserve free-form meaning and mark each answer `CONFIRMED`, `PROVISIONAL`, `UNKNOWN`, or `NOT_APPLICABLE`.
5. Separate facts, assumptions, conflicts, and missing information.
6. Recommend at most three matching Profiles with fit, mismatch, defaults, and tradeoffs.
7. Stop for explicit user selection. Never select a Profile on the user's behalf.
8. Before activating any role, assign each selected role a unique semantic display name in `<role-prefix>-<person-name>` form, such as `designer-tony` or `frontend-bob`. Validate it with `validators/validate-agent-name.sh`, then check registry uniqueness and semantic readability. Never use a hash, UUID, timestamp, random string, or opaque runtime ID as the display name.
9. Write `.planning/agt/agents.yaml`. Preserve the hyphenated `display_name`; if Codex requires a restricted task name, record an underscore `runtime_name` separately.
10. After selection, write the product repository manifest, questionnaire record, agent registry, and initial workflow state. Record the exact agt Git revision and Profile version, and set `active_agent` to the semantic display name.
11. Activate product planning as the next suggested role, but do not perform product planning in this Skill.

If no usable Profile exists, report the missing capability and preserve the questionnaire answers. Do not invent a selectable Profile or initialize a misleading manifest.
