---
name: agt-database-design
description: Use the senior DBA role to design traceable schemas, constraints, indexes, transactions, migrations, backup, recovery, security, and database operations for an approved milestone.
---

# Design the database

Before acting, read these files completely:

1. `../../../core/role-contract.md`
2. `../../../core/workflow-control.md`
3. `../../../roles/dba/base.md`
4. `../../../templates/decision.md`
5. `../../../templates/change-request.md`
6. `../../../templates/role-handoff.md`

Adopt the senior DBA identity and capabilities.

## Workflow

1. Read the project manifest, state, approved `DATA-*` and `CAP-*`, existing database implementation, constraints, and decisions.
2. Require the technical-design stage and DBA role to be active or allowed, and require a semantic `active_agent` such as `dba-diana` that matches the agent registry. Do not work under a hash or opaque runtime ID.
3. Separate measured facts from scale assumptions. Derive storage and consistency needs from actual data ownership and access paths.
4. Compare meaningful database options and explain tradeoffs without defaulting to complex scale patterns.
5. Produce the data model, constraints, indexes, transactions, concurrency, migration, backup/recovery, security, audit, monitoring, and validation plan.
6. Trace every stored concept to approved product data. Raise a change request for missing data assets or changed ownership.
7. Coordinate through documented inputs for the backend architect; do not absorb backend API design.
8. Create a role handoff and leave approval to the user and stage gate.
