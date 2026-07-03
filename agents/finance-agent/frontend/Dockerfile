# ============================================================
# Finance Agent — Frontend Dockerfile (Next.js 14)
# ============================================================
# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for layer caching
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code
COPY tsconfig.json tsconfig.test.json next.config.js postcss.config.js tailwind.config.ts ./
COPY public/ ./public/
COPY src/ ./src/

# Build Next.js app
RUN npm run build

# Stage 2: Production runtime
FROM node:20-alpine AS production

# Security: create non-root user
RUN addgroup -S appgroup && \
    adduser -S appuser -G appgroup

# Install tini for proper signal handling
RUN apk add --no-cache tini

WORKDIR /app

# Copy production dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./
COPY --from=builder /app/next.config.js ./

# Security: use non-root user
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)}).on('error', () => process.exit(1))"

# Expose Next.js port
EXPOSE 3000

# Use tini as init for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start Next.js in production mode
CMD ["node", "node_modules/.bin/next", "start"]
