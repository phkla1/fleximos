# Scoped Business Access

Fleximotion separates system administration from business visibility.

- `owner` and `admin` are global system roles stored on the user account.
- `manager`, `finance`, `supervisor`, and `operator` are business roles granted through scoped assignments.
- An assignment targets the whole company, an amoeba, a site, or a supervisor-led team.
- A person's effective visibility is the union of every active, currently valid assignment.
- Several people can hold the same role over the same scope.
- One person can hold the same role across several scopes without creating a new role type.

## Integration flow

1. A system administrator creates or locates the canonical `person_id`.
2. The administrator creates the user account.
3. The administrator creates one or more `POST /identity/v1/role-assignments` records.
4. Consumers authenticate the user and call `GET /identity/v1/me`.
5. Domain APIs use `role_assignments` from the validated profile to restrict business data.

Example:

```json
{
  "person_id": "person_cofounder",
  "role": "manager",
  "scope_type": "amoeba",
  "scope_id": "amoeba_mainland"
}
```

Create another assignment for `amoeba_island` to give the same Manager both scopes. Do not invent a broader role solely to combine visibility.

## Validity and removal

Assignments support `valid_from`, optional `valid_to`, and `status`. Set `status` to `inactive` to remove access while retaining the audit trail. `GET /identity/v1/me` returns only active assignments whose validity window includes the current time.

## Current team identifier

During the Ops MVP, a `team` scope uses the supervisor's `person_id` as `scope_id`. A dedicated team entity can replace this representation later without changing the role-assignment concept.

## Finance and manager boundaries

Finance and manager users can be assigned to the same amoeba or company scope, but they are not interchangeable.

| Surface | Manager assignment | Finance assignment | Owner/admin/service |
| --- | --- | --- | --- |
| Ops roster, performance, cash status | Scoped read | Scoped read | Global read |
| Finance console review/export | Scoped read | Scoped read and finance actions | Global read and actions |
| Ops cash adjustments | Read only | Create audited adjustments within scope | Create audited adjustments |
| Payments settlement, finance approval, sandbox deposit simulation, period close | Read only | Allowed | Allowed |
| System administration and role assignment | Not allowed | Not allowed | Allowed |

If a person needs both business oversight and finance authority, assign both `manager` and `finance` roles over the relevant scope. The effective data scope is the union of their active assignments; the mutation authority is still checked per action.
