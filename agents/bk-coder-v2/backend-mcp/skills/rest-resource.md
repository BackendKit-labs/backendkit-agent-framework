---
name: rest-resource
version: 1.0.0
description: Layered REST resource pattern (controller → service → repository) with DTO validation and error mapping. Activated when a backend phase builds an HTTP API, endpoint or CRUD resource.
triggers:
  - rest
  - api
  - endpoint
  - crud
  - controller
  - resource
  - route
  - http handler
# language gating omitted on purpose for the POC so the skill is never filtered out
# by stack detection. In production, scope it: language: [node, typescript]
---

## REST Resource — Layered Pattern

When implementing an HTTP API / CRUD resource, structure the code in three layers
with one-way dependencies (controller → service → repository). Never let a
controller touch persistence directly.

### Layering rules
- **Controller** — parses/validates the request, maps to a service call, maps the
  result to an HTTP response. No business logic, no DB access.
- **Service** — business rules and orchestration. Pure-ish: takes/returns domain
  types, throws domain errors. Never imports HTTP types (no `Request`/`Response`).
- **Repository** — the only layer that talks to the data store.

### DTO validation (boundary)
- Validate every inbound payload at the controller boundary with a schema
  (zod/class-validator). Reject early with 400 + a field-level error list.
- Never pass an unvalidated request body into the service layer.

### Error mapping
Map domain errors to HTTP status centrally (one error filter / middleware), never
ad-hoc in each handler:

| Domain error      | HTTP |
|-------------------|------|
| NotFoundError     | 404  |
| ValidationError   | 400  |
| ConflictError     | 409  |
| UnauthorizedError | 401  |
| (unmapped)        | 500  |

### Definition of done for a resource
- [ ] Controller + service + repository split, dependencies injected
- [ ] Inbound DTO validated with a schema; 400 on invalid input
- [ ] Domain errors mapped to status codes via a single error filter
- [ ] Unit test for the service (happy path + one error path)
- [ ] No `any`, no business logic in the controller
