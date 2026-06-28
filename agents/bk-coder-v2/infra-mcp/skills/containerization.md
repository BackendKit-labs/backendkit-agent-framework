---
name: containerization
version: 1.0.0
description: Container and CI/CD conventions — multi-stage non-root Dockerfile, healthchecks, compose service layout, and a minimal CI pipeline. Activated when generating Docker, Compose, Kubernetes or CI configuration.
triggers:
  - docker
  - dockerfile
  - compose
  - kubernetes
  - k8s
  - ci
  - cd
  - pipeline
  - infra
  - infraestructura
  - deploy
  - manifest
  - manifiesto
---

## Containerization & CI Conventions

Detect the stack from the project manifest first (`package.json`, `go.mod`, `requirements.txt`,
`pom.xml`). Generate only what the stack needs — do not emit a Java pipeline for a Node project.

### Dockerfile
- **Multi-stage**: a `build` stage with full toolchain, a slim `runtime` stage that copies only
  the built artifact + production deps.
- **Non-root**: create and `USER` a non-root account in the runtime stage.
- **Pin** the base image to a specific minor tag (`node:20-slim`, not `node:latest`).
- **HEALTHCHECK** that hits the app's liveness path.
- Ship a `.dockerignore` (node_modules, .git, dist artifacts, .env).

### docker-compose.yml
- One service per process; the app `depends_on` its datastore.
- Config via environment, secrets via `env_file` — never inline secrets.
- Named volumes for stateful services; expose only the ports actually needed.

### CI pipeline (GitHub Actions unless told otherwise)
Stages in order: `install → lint → test → build → docker build`. Fail fast — a failed lint
stops the run. Cache the dependency layer.

### Kubernetes (only if requested)
Deployment + Service + ConfigMap/Secret. Set resource requests/limits, readiness + liveness
probes, and `runAsNonRoot: true`.

### Definition of done
- [ ] Dockerfile: multi-stage, non-root, pinned base, healthcheck
- [ ] .dockerignore present
- [ ] compose: no inline secrets, datastore wired via depends_on
- [ ] CI: install→lint→test→build, fail-fast
