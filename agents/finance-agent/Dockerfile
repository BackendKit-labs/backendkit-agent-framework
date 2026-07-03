# ============================================================
# Finance Agent — Dockerfile (Multi-stage build)
# ============================================================
# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for layer caching
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Prune dev dependencies for smaller production image
RUN npm prune --omit=dev

# Stage 2: Production runtime
FROM node:20-alpine AS production

# Security: create non-root user
RUN addgroup -S appgroup && \
    adduser -S appuser -G appgroup

# Install tini for proper signal handling
RUN apk add --no-cache tini

WORKDIR /app

# Copy production dependencies only (already pruned)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Copy config directory
COPY config/ ./config/

# Security: use non-root user
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)}).on('error', () => process.exit(1))"

# Expose MCP HTTP port
EXPOSE 3000

# Use tini as init for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Default command (can be overridden for STDIO mode)
CMD ["node", "dist/entry-points/mcp-http.js"]
