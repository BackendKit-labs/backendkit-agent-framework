# Reference agent image for agent-cloud. Implements the agent-image contract:
# long-lived process, reads AGENT_ID/AGENT_TYPE/MODEL, exposes /health.
FROM node:20-alpine

WORKDIR /agent
COPY entrypoint.mjs .

ENV AGENT_TYPE=generic \
    AGENT_PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["node", "entrypoint.mjs"]
