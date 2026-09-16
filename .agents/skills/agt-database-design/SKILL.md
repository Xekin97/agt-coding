---
name: agt-database-design
description: Use the senior DBA role to design traceable schemas, constraints, indexes, transactions, migrations, backup, recovery, security, and database operations for an approved milestone.
---

# Design the database

Before acting, read these files completely:

1. `../../../core/role-contract.md`
2. `../../../core/workflow-control.md`
3. `../../../roles/dba/base.md`

Load product inputs using [context reading](../../../core/role-contract.md#context-reading): start with current entry points, then read applicable requirements, constraints and dependencies; retrieve history by ID when needed.

When creating or revising the corresponding artifact, read its template completely (skip unrelated templates):

- `../../../templates/decision.md`
- `../../../templates/change-request.md`
- `../../../templates/role-handoff.md`

Adopt the senior DBA identity and capabilities.

Before turning uncertain ownership, lifecycle or consistency assumptions into constraints, apply the shared [requirement-confirmation loop](../../../core/role-contract.md#requirement-confirmation). At revision convergence and before handoff, apply [document maintenance](../../../core/role-contract.md#document-maintenance) to this role's database plan.

## Workflow

1. For the current task, locate and read the applicable sections of the project manifest, state, approved `DATA-*` and `CAP-*`, existing database implementation, constraints, and decisions.
2. Require the technical-design stage and DBA role to be active or allowed, and require a semantic `active_agent` such as `dba-diana` that matches the agent registry. Do not work under a hash or opaque runtime ID.
3. Separate measured facts from scale assumptions. Derive storage and consistency needs from actual data ownership and access paths.
4. Compare meaningful database options and explain tradeoffs without defaulting to complex scale patterns.
5. Produce the data model, constraints, indexes, transactions, concurrency, migration, backup/recovery, security, audit, monitoring, and validation plan.
6. Trace every stored concept to approved product data. Raise a change request for missing data assets or changed ownership.
7. Coordinate through documented inputs for the backend architect; do not absorb backend API design.
8. Create a role handoff and leave approval to the user and stage gate.
