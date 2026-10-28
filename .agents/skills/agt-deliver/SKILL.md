---
name: agt-deliver
description: Coordinate role-owned semantic cleanup, scoped branch delivery and immutable milestone closeout using the project's recorded policy.
---

# Deliver an AGT task

Read `../../../core/role-contract.md`, `../../../roles/delivery/base.md` and `../../../core/delivery.md`. Identify the separate product repository, locked framework/Profile, exact task scope, branch and existing edits. Use a named `delivery-<person-name>`; do not change milestone role/stage merely to coordinate delivery.

Use `../../../adapters/delivery/agt-delivery.mjs --help`. Reuse explicit user adoption and execution authorization. Schema 2 uses branch-tracked planning, main as final integration target, and the recorded engineering deployment document. Tracked planning is expected; do not untrack or ignore it. Old locked projects need explicit migration, not silent conversion.

Create milestone/Quick branches from main, recording predecessor and source commit. Workstreams belong to either parent and merge normally only into it. Final parent delivery uses squash. Preserve existing edits and unrelated work; never force/reset/stash them to make a command pass.

At closeout, first integrate this delivery's children and fix the candidate. Have affected authors consolidate current requirements, design, technical contracts, implementation and testing. Delete fixed-and-verified bug process records, obsolete designs/logs/screenshots and duplicate handoffs. Preserve current final acceptance/evidence and actual unresolved limits. No archives, compression, backup copies or restoration indexes for discarded material. A single session can perform responsibilities serially; never invent independent agents or QA.

Record inventory/review after actual semantic cleanup. Quick finish and workstream accept save final results; parent closeout uses the accepted candidate. Use prepare/verify/finish for final squash and require matching source/main/candidate versions. Separate semantic review, static integrity and any actual independent acceptance. Final summaries must remain readable without discarded process files.

After acceptance, cleanup and delivery, the milestone is closed and read-only. Later milestone/Quick changes belong to their own scope. Historical remediation is a separately authorized one-time exception, preserving original completion conclusions and resealing afterward; it is not ordinary reopening.

Stage only the authorized task paths, including valid planning on the development branch. Run check --staged before commit and candidate checks against the verified baseline. Protect closed directories. These explicit commands are not an installed Git hook. Do not push, publish or deploy without applicable user authorization; reuse actual deployment policy when authorized.
