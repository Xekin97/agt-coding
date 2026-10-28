---
name: agt-workstream
description: Create, inspect, resume, integrate, and clean up independent agt requirement workflows across Git worktrees. Use for multiple windows advancing separate requirements within one milestone, including integration from any window.
---

# Manage independent requirement workflows

Read [workflow control](../../../core/workflow-control.md) and the relevant operation in [workstreams](../../../core/workstreams.md). Use the executable at `../../../adapters/workstreams/agt-workstream.mjs`; run `--help` for exact arguments. It requires Git, Node.js, and Ruby, already used by agt validators.

Identify the separate product repository. This skill manages workflow lifecycle and local Git operations; it does not author specialist deliverables or approve stages. No permanent primary window exists: management commands may run from any linked product worktree. A user request to integrate authorizes preparing, testing, and locally integrating the specified requirement; it does not authorize push or deployment. Reuse explicit adoption/role/stage approvals already given for the same scope.

## Adopt or create

- Inspect the locked manifest/Profile and existing state. Legacy projects stay in single-flow mode until explicitly adopting the compatible Profile and configuration. Show concrete adoption differences if adoption is not already authorized; preserve old artifacts and approvals.
- After adoption is recorded and committed on the chosen integration branch, run `create` with a meaningful slug, the user's title and confirmed scope, a unique semantic product agent name, and known dependencies. It creates the new requirement's metadata and initial workflow, committed on its scoped development branch. Parent may be a milestone or Quick; never target main directly.
- Report the resulting worktree path and branch so the user can open it. Do not open terminals or spawn agents automatically. Product planning is the initial stage; creation does not approve later stages.

## Inspect or resume

- `list` reports live state, committed state, dirty worktrees, blocking IDs, handoff entry points and integration receipts. Read only the related handoff/open items to explain next actions.
- `resume` finds or restores a worktree. In that worktree run `context` and claim the writer session before specialist writes. Reuse an owned lease, otherwise inspect and release/recover the previous owner; never steal a live lease.
- Specialist work uses the existing agt skills and scoped stage gate. New role names are allocated through `activate` under the shared management lock. A runtime session token is not a semantic agent name.

## Integrate

1. Verify the requirement has completed scoped user acceptance, approval and developer/QA evidence refer to the actual version, and its dependencies/shared contract decisions are current. The stage gate records `accept`; this manager cannot manufacture it. Release its writer lease before integration.
2. Run `integrate --id <slug>` from any project worktree. It merges in a temporary detached worktree and leaves the target untouched until checks pass. Inspect the resulting diff for scope and unintended cross-requirement changes.
3. Resolve mechanical conflicts using approved intent. Product/API/architecture disagreements go to the owning role. Retain unresolved work and use `pause-integration` when handing it off.
4. Select meaningful integration checks from the affected requirements and project commands; run `check` with an argv-array JSON file outside the candidate. A passing requirement-only test does not establish combined behavior. Complete any browser/manual acceptance required by the existing plans and record its evidence with the scoped reports before final acceptance.
5. Run `finish` only on the verified candidate. It rechecks source/target versions and dirty worktrees, records evidence and fast-forwards the target. Source/target changes require reprepare/revalidation. No force push, reset, stash, auto-stage of unrelated files, or automatic milestone approval.
6. Report the integrated commit, tested scope, remaining integration/acceptance items, and cleanup eligibility. Cleanup may run from another window after the requirement and temporary worktree are safely integrated; branches and formal records remain.

On failures, explain the retained worktree/evidence and concrete recovery command. A successful Git merge does not resolve semantic conflicts or prove milestone completion. Never treat a missing binding as permission to overwrite project-level state.

When [branch delivery](../../../core/delivery.md) is adopted, configure `enable --milestone M001 --target milestone/M001` or `enable --quick Q001-slug --target quick/Q001-slug`. Commit scoped planning with code; final accepted content uses readable summaries, not archives. Children merge normally into the parent. Final parent-to-main delivery uses squash and closes the completed scope read-only. Later work must not mutate a closed milestone.
