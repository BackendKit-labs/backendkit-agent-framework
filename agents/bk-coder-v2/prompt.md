
```markdown
# BackendKit Coder v2 — Prompt de Inicio

## Objetivo
Construir BackendKit Coder v2, un agente codificador multi-agente que reemplaza al bk-agent actual.

## Stack
- TypeScript 5.x, Node.js 18+
- Framework: @backendkit-labs/agent-core (AgentProfile, buildEngine)
- MCP Server: @backendkit-labs/mcp-server (AgentMCPServer)
- Validación: Zod
- Embeddings: nomic-embed-text-v1 (único, centralizado en codex, ~274MB)
- Comunicación: pipes stdin/stdout (MCP stdio). NO HTTP entre agentes.

## Diferencia fundamental con bk-agent
En bk-agent un LLM general lo intenta todo él mismo, se equivoca, y recién cuando falla delega (reactivo, caro en tokens, contexto contaminado). En Coder v2, el Director itera con el humano hasta tener un diseño consensuado, guarda todo en memoria, invoca al Orchestrator, que consulta el Project Manager y delega directo al especialista correcto (proactivo). Los gates son deterministas (Cable 2), no dependen del LLM. QA es independiente del que implementó. Cada agente tiene su propio proceso stdio, su modelo óptimo, y su vault de conocimiento (fijo, global, no cambia al switchear de proyecto).

## Arquitectura
Director → Orchestrator-Agent V2 → Agentes MCP stdio (Design, Backend, QA, Security, Infra, Frontend opcional)
                                 → Codex-Context-V2 (vaults + memoria 3-tier)
                                 → Workspace Manager PROJECT (projectRoot, agents, memory)
                                 → Workspace Manager VAULT (vaults de conocimiento)

## Vaults vs Memoria (CORREGIDO)
VAULTS → Conocimiento PERMANENTE del agente (su expertise). FIJOS. NO cambian al switchear.
  vaults/backend/*, vaults/qa/*, vaults/security/*, vaults/design/*, vaults/infra/*
  Cada agente crea el suyo cuando nace. El Director tiene vaults/agent-framework/*.

MEMORIA → Contexto VIVO del proyecto (compartida entre todos los agentes). CAMBIA al switchear.
  memories/{projectId}/knowledge/*, patterns/*, episodes/*

## Resolución de consultas
search_vault({query}) → Codex consulta VAULT MANAGER (workspace_current)
search_knowledge({query}) → Codex consulta PROJECT MANAGER (project_current → memoryNamespace)

## Flujo SDD
FASE 0: Director + Humano iteran → todo queda en memoria
FASE 1: Director invoca Coder v2 con namespace
FASE 2: Design-MCP lee memoria → genera specification.md, design.md, ROADMAP.md
FASE 3: Gate Humano aprueba archivos
FASE 4: Backend-MCP implementa por fase + QA-MCP valida independientemente
FASE 5: Security-MCP revisa (automático por Cable 2)
FASE 6: Infra-MCP genera Docker, K8s, CI/CD
FASE 7: Curar conocimiento + promover patrones

## Orden de implementación
1. Workspace Manager PROJECT
2. Codex-Context-V2 extendido (namespaces + memoria 3-tier + resolución dual)
3. Backend-MCP
4. QA-MCP
5. Security-MCP
6. Infrastructure-MCP
7. Frontend-MCP (opcional)
8. Orchestrator V2
9. Reflection Engine (MAPE-K)
```