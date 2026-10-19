---
name: agt-start-project
description: Initialize an agt-coding product workspace, run the structured product questionnaire, recommend available Profiles, and create the locked project manifest after explicit user selection.
---

# Start an agt-coding project

Before acting, read these files completely:

1. `../../../core/role-contract.md`
2. `../../../core/workflow-control.md`
3. `../../../roles/bootstrap/ROLE.md`

Load product inputs using [context reading](../../../core/role-contract.md#context-reading): start with current entry points, then read applicable requirements, constraints and dependencies; retrieve history by ID when needed.

Run `validators/validate-profile.sh <profile-path>` and `validators/validate-agent-name.sh <name>` from the framework root at their workflow checks. Read validator source only when diagnosing a failure; executing checks remains required.

When creating or revising the corresponding artifact, read its template completely (skip unrelated templates):

- `../../../templates/product-questionnaire.md`
- `../../../templates/workflow-state.yaml`
- `../../../templates/agent-registry.yaml`

Adopt the project initialization expert identity and capabilities for this task.

Apply the shared [requirement-confirmation loop](../../../core/role-contract.md#requirement-confirmation) when interpreting ambiguous questionnaire answers. Consolidate this role's questionnaire and handoff using [document maintenance](../../../core/role-contract.md#document-maintenance); Profile selection remains a separate explicit choice.

## Workflow

1. Identify the framework and separate product repository. Check for an existing manifest/state before initialization; an added requirement in an existing project follows its current workflow and the shared [authorization scope](../../../core/workflow-control.md#authorization-scope), not reinitialization or automatic milestone numbering. Do not overwrite its locked setup or put product artifacts in this repository.
2. Confirm that this Skill is running from the repository-local `.agents/skills`; do not install, copy, or modify user-global Skills.
3. Inspect actual `profiles/*/PROFILE.yaml` files. Validate each candidate with `validators/validate-profile.sh`; only recommend Profiles that exist, pass validation, and declare `status: available`.
4. Run the structured questionnaire in small coherent groups. Preserve free-form meaning and mark each answer `CONFIRMED`, `PROVISIONAL`, `UNKNOWN`, or `NOT_APPLICABLE`.
5. Separate facts, assumptions, conflicts, and missing information.
6. Recommend at most three matching Profiles with fit, mismatch, defaults, and tradeoffs.
7. Stop for explicit user selection. Never select a Profile on the user's behalf.
8. Before activating any role, assign each selected role a unique semantic display name in `<role-prefix>-<person-name>` form, such as `designer-tony` or `frontend-bob`. Validate it with `validators/validate-agent-name.sh`, then check registry uniqueness and semantic readability. Never use a hash, UUID, timestamp, random string, or opaque runtime ID as the display name.
9. Write `.planning/agt/agents.yaml`. Preserve the hyphenated `display_name`; if Codex requires a restricted task name, record an underscore `runtime_name` separately.
10. After selection, write the product repository manifest, questionnaire record, agent registry, and initial workflow state. Record the exact agt Git revision and Profile version, and set `active_agent` to the semantic display name. Keep state compact using existing Profile paths and source references; merge a short reference to the shared context-reading rule into existing product agent instructions when present, preserving their other rules. Do not create duplicate planning entry files.
11. Activate product planning as the next suggested role, but do not perform product planning in this Skill.

Profiles may advertise opt-in workstreams. Keep single-flow initialization by default. If the user explicitly chooses independent requirement workflows, record that choice and route adoption to `$agt-workstream` after the manifest/Profile are locked; do not silently enable it or duplicate specialist definitions.

If no usable Profile exists, report the missing capability and preserve the questionnaire answers. Do not invent a selectable Profile or initialize a misleading manifest.
