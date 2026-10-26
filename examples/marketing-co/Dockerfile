FROM node:22-alpine

WORKDIR /app

COPY package.json ./

RUN npm install --omit=dev

COPY agents/ ./agents/

ENV PORT=8080
ENV HOST=0.0.0.0
EXPOSE 8080

ARG AGENT_SCRIPT
ENV AGENT_SCRIPT=${AGENT_SCRIPT}

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/v1/agent/health || exit 1

CMD ["sh", "-c", "node agents/$AGENT_SCRIPT"]
