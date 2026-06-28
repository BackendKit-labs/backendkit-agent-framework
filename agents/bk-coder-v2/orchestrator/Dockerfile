# =============================================================================
# Stage 1: Builder
# =============================================================================
FROM node:20-slim AS builder

WORKDIR /app

# Copy dependency manifests first for layer caching
COPY package.json package-lock.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src/ src/

# Compile TypeScript
RUN npm run build

# Prune devDependencies — keep only production deps
RUN npm prune --omit=dev

# =============================================================================
# Stage 2: Runtime
# =============================================================================
FROM node:20-alpine AS runtime

# Security: run as non-root user
USER node

WORKDIR /app

# Copy production node_modules from builder
COPY --from=builder --chown=node:node /app/node_modules node_modules/

# Copy compiled output
COPY --from=builder --chown=node:node /app/dist dist/

# Copy package.json for metadata (not used at runtime)
COPY --chown=node:node package.json ./

# Expose the application port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1))"

# Start the server
CMD ["node", "dist/server.js"]
