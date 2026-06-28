# knowledge-vault — per-project knowledge vault + RAG (codex-context-agent-v2),
# packaged as an agent-cloud agent image. Implements the agent-image contract:
# long-lived HTTP service exposing GET /health (here: the MCP server in HTTP mode).
#
# Build from the MONOREPO ROOT so npm workspaces can resolve @backendkit-labs/*:
#   docker build -t knowledge-vault:latest -f agents/codex-context-agent-v2/Dockerfile .

# ── builder ────────────────────────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /repo

# Toolchain for any workspace that builds native addons via node-gyp.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install the whole workspace graph (native binaries built for linux here),
# then build only what knowledge-vault needs.
COPY . .
RUN npm ci
RUN npm run build \
  -w @backendkit-labs/infra \
  -w @backendkit-labs/agent-core \
  -w @backendkit-labs/agent-enterprise \
  -w @backendkit-labs/codex-context-agent-v2

# ── runtime ────────────────────────────────────────────────────────────────────
FROM node:20-slim AS runtime
WORKDIR /repo/agents/codex-context-agent-v2

ENV NODE_ENV=production \
    AGENT_TYPE=knowledge-vault \
    CODEX_HTTP_PORT=8080 \
    CODEX_PROVIDER=anthropic

# Workspace symlinks in node_modules point into packages/*, so copy the built repo whole.
COPY --from=builder /repo /repo

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.CODEX_HTTP_PORT||8080)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/server.js"]
