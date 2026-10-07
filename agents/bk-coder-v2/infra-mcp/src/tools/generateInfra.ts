import { z }                from 'zod';
import type { AgentToolDef } from '@backendkit-labs/mcp-server';

export const generateInfraSchema = {
    projectRoot: z.string().describe('Absolute path to the project root directory'),
};

export const generateInfraTool: AgentToolDef<typeof generateInfraSchema> = {
    name:        'generate_infra',
    description: 'Generate complete infrastructure configuration: Dockerfile, docker-compose.yml, CI/CD pipeline, and Kubernetes manifests. Auto-detects the project stack.',
    schema:      generateInfraSchema,
    buildPrompt: (args: any) => {
        const { projectRoot } = args;
        return `You are a DevOps expert generating production-ready infrastructure for a project.

## Step 1 — Detect the stack
Read the following to understand the project:
- read_file("${projectRoot}/package.json")     (Node.js/TypeScript)
- read_file("${projectRoot}/go.mod")           (Go)
- read_file("${projectRoot}/requirements.txt") (Python)
- read_file("${projectRoot}/Cargo.toml")       (Rust)
- read_file("${projectRoot}/.specs/design.md") if it exists — check "## Project Structure";
  a full-stack project may use separate \`backend/\`/\`frontend/\` trees instead of one \`src/\`
Use list_directory on ${projectRoot} to understand the real structure (don't assume \`src/\`).

## Step 2 — Generate all infrastructure files using write_file

### Dockerfile (multi-stage, production-ready)
write_file("${projectRoot}/Dockerfile", "...")
- Multi-stage: builder + slim runtime
- Non-root user
- Health check
- No secrets in image

### docker-compose.yml
write_file("${projectRoot}/docker-compose.yml", "...")
- App service + all dependencies (db, cache, etc.)
- Health checks on all services
- Environment variables from .env file
- Named volumes

### .dockerignore
write_file("${projectRoot}/.dockerignore", "...")

### CI/CD pipeline
write_file("${projectRoot}/.github/workflows/ci.yml", "...")
- Trigger: push + PR
- Steps: install → lint → test → build → Docker build/push
- Cache dependencies

### Kubernetes manifests
write_file("${projectRoot}/k8s/deployment.yaml", "...")
write_file("${projectRoot}/k8s/service.yaml", "...")
write_file("${projectRoot}/k8s/configmap.yaml", "...")
write_file("${projectRoot}/k8s/ingress.yaml", "...")
write_file("${projectRoot}/k8s/hpa.yaml", "...")

## Principles
- Security: non-root, read-only filesystem where possible, no hardcoded secrets
- Performance: layer caching, slim images, resource limits
- Reproducibility: pinned versions, not :latest

## Step 3 — Return summary
List the files you created and the detected stack.`;
    },
};
