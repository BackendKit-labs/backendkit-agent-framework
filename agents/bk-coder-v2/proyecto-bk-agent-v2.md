---

# 🏗️ BackendKit Coder v2 — Especificación de Arquitectura

## Stack: Orchestrator + Agentes MCP stdio + Memoria Compartida + Codex Centralizado + Workspace Manager v2

---

## Índice
1. [Diagrama General](#1-diagrama-general)
2. [Workspace Manager v2](#2-workspace-manager-v2)
3. [Agentes del Ecosistema](#3-agentes-del-ecosistema)
4. [Flujo Spec-Driven Development](#4-flujo-spec-driven-development)
5. [Sistema de Calidad (QA + Gates)](#5-sistema-de-calidad)
6. [Memoria Compartida + Codex](#6-memoria-compartida--codex)
7. [Reflection Engine (MAPE-K)](#7-reflection-engine)
8. [Especificación de Tools MCP](#8-especificación-de-tools-mcp)
9. [Modelo de Configuración](#9-modelo-de-configuración)
10. [Estrategia de Despliegue](#10-estrategia-de-despliegue)

---

## 1. Diagrama General

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            DIRECTOR                                          │
│                    (Interfaz conversacional con el usuario)                    │
│                    Tools: mcp__coder__*                                       │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────────────┐
│                      ORCHESTRATOR-AGENT V2                                   │
│                                                                               │
│  ┌──────────────────────────────────────────────────────────┐               │
│  │                    PLANIFICADOR (LLM)                     │               │
│  │  - Recibe objetivo del Director                           │               │
│  │  - Descompone en subtareas con dependencias               │               │
│  │  - Asigna cada subtarea al agente stdio correspondiente  │               │
│  │  - Gestiona gates, aprobaciones, reintentos               │               │
│  └──────────────────────────────────────────────────────────┘               │
│                               │                                               │
│  ┌────────────────────────────▼─────────────────────────────┐               │
│  │                    EJECUTOR                               │               │
│  │  - Pool de agentes stdio (child_process)                  │               │
│  │  - Pipe stdin/stdout MCP                                  │               │
│  │  - Timeouts, health checks, auto-restart                  │               │
│  │  - Cola de tareas (BullMQ)                                │               │
│  └──────────────────────────────────────────────────────────┘               │
│                               │                                               │
│  ┌────────────────────────────▼─────────────────────────────┐               │
│  │         WORKSPACE MANAGER V2 (CLIENTE HTTP/MCP)          │               │
│  │  - Consulta config del proyecto activo                    │               │
│  │  - workspace_agent_config("backend") → vault, modelo,... │               │
│  │  - workspace_policies() → reglas Cable 2                  │               │
│  └──────────────────────────────────────────────────────────┘               │
└──────────┬──────────┬──────────┬──────────┬──────────────────────────────────┘
           │          │          │          │
      Lanza│     Lanza│     Lanza│     Lanza│
      child│    child │    child │    child │
           │          │          │          │
┌──────────▼──┐ ┌─────▼─────┐ ┌──▼────────┐ ┌──▼──────────┐
│  DESIGN     │ │  BACKEND  │ │   QA      │ │  SECURITY   │
│  MCP stdio  │ │  MCP stdio│ │  MCP stdio│ │  MCP stdio  │
├─────────────┤ ├───────────┤ ├───────────┤ ├─────────────┤
│ Modelo:     │ │ Modelo:   │ │ Modelo:   │ │ Modelo:     │
│ configurable│ │configurable│ │configurable│ │ configurable│
│ (R1, GPT)  │ │(V3, GPT)  │ │(Sonnet)   │ │ (GPT-4o)   │
├─────────────┤ ├───────────┤ ├───────────┤ ├─────────────┤
│ Tools:      │ │ Tools:    │ │ Tools:    │ │ Tools:      │
│ read_file   │ │ read_file │ │ read_file │ │ read_file   │
│ write_file  │ │ write_file│ │ write_file│ │ write_file  │
│ execute_cmd │ │execute_cmd│ │execute_cmd│ │ execute_cmd │
│ search_vault│ │search_vault││search_vault││ search_vault│
│ memory_*    │ │ memory_*  │ │ memory_*  │ │ memory_*    │
└──────┬──────┘ └─────┬─────┘ └─────┬─────┘ └──────┬───────┘
       │              │             │              │
       └──────────────┼─────────────┼──────────────┘
                      │             │
             ┌────────▼─────────────▼────────┐
             │    codex-context-agent-v2      │
             │                                │
             │ ┌──────────────────────────┐   │
             │ │  1 LLM de embeddings     │   │  ← nomic-embed-text (~274MB)
             │ │  nomic-embed-text-v1     │   │
             │ └──────────────────────────┘   │
             │                                │
             │ ┌──────────────────────────┐   │
             │ │  ÍNDICE RAG ÚNICO        │   │
             │ │  con namespaces:         │   │
             │ │                          │   │
             │ │  vaults/{proyecto}/      │   │
             │ │    design/*              │   │
             │ │    backend/*             │   │
             │ │    security/*            │   │
             │ │    qa/*                  │   │
             │ │                          │   │
             │ │  memories/{proyecto}/    │   │
             │ │    knowledge/*           │   │
             │ │    patterns/*            │   │
             │ │    episodes/*            │   │
             │ └──────────────────────────┘   │
             │                                │
             │ ┌──────────────────────────┐   │
             │ │  WORKSPACE MANAGER V2    │   │
             │ │  (Servidor MCP)          │   │
             │ │  Gestiona:               │   │
             │ │  - Proyectos/ámbitos     │   │
             │ │  - Config de cada agente │   │
             │ │  - Policies por proyecto │   │
             │ │  - Modelos asignados     │   │
             │ └──────────────────────────┘   │
             └────────────────────────────────┘
```


```markdown
# BackendKit Coder v2 — Especificación del Proyecto

## Stack tecnológico
- TypeScript 5.x, Node.js 18+
- Framework MCP: @backendkit-labs/agent-core (AgentProfile, buildEngine)
- MCP Server: @backendkit-labs/mcp-server (AgentMCPServer)
- Protocolo: @modelcontextprotocol/sdk
- Validación: Zod
- Embeddings: nomic-embed-text-v1 (único, centralizado en codex, ~274MB)
- Almacenamiento: JSON filesystem (~/.backendkit/)
- Cache de resolución de namespace: TTL 30s en codex

## ~/.backendkit/ — PERTENECE AL ECOSISTEMA
Lo crea el framework @backendkit-labs/agent-core (initBkHome() en buildEngine()). Es idempotente.
Coder v2 NO lo crea. Lo asume existente.

Estructura:
~/.backendkit/
├── projects.json              ← Workspace Manager PROJECT
├── vaults/
│   ├── agent-framework/       ← Director (ya existe, 722 notas)
│   ├── backend/               ← Backend-MCP
│   ├── qa/                    ← QA-MCP
│   ├── security/              ← Security-MCP
│   ├── design/                ← Design-MCP
│   └── infra/                 ← Infra-MCP
├── memories/{projectId}/
│   ├── knowledge/
│   ├── patterns/
│   └── episodes/
├── config/                    ← config-agent (existente)
├── notifier/                  ← notification-agent (existente)
└── scheduler/                 ← schedule-agent (existente)

## Componentes

### Director
Centro del ecosistema. Punto único de entrada. Hace:
- Design conversacional: itera con humano, guarda en memoria (save_knowledge, learn_pattern, remember)
- RBAC: autenticación, roles (admin, dev, tech-lead, viewer), auditoría
- Invoca flujos SDD al Coder v2
- Despliega (fleet: Docker/K8s)
- Gestiona agentes (schedule, notification, config)
- Tools MCP: codex, fleet, runs, orchestrator, coder

### Orchestrator-Agent V2
- Planifica flujos SDD (descompone objetivos en subtareas con dependencias)
- Pool de procesos stdio (child_process por agente, pipes MCP)
- Health checks, auto-restart, timeouts
- Aplica gates (Cable 2 deterministas + humanos)
- NO intenta hacer el trabajo él mismo. Siempre delega.

### Agentes MCP stdio

Cada uno usa el patrón: AgentProfile + buildEngine() + AgentMCPServer

| Agente | Modelo | Temperatura | Vault (fijo) | Responsabilidad |
|--------|--------|-------------|--------------|-----------------|
| Design | deepseek-r1 | 0.7 | vaults/design/* | SPECIFY: generate_spec, design, roadmap |
| Backend | deepseek-v3 | 0.3 | vaults/backend/* | IMPLEMENT: implement_feature, write_code |
| QA | claude-sonnet | 0.3 | vaults/qa/* | VERIFY: run_qa_phase, validate, generate_tests |
| Security | gpt-4o | 0.2 | vaults/security/* | SECURITY REVIEW automático por Cable 2 |
| Infra | deepseek-v3 | 0.3 | vaults/infra/* | Docker, K8s, CI/CD |
| Frontend | gemini/deepseek | 0.4 | vaults/frontend/* | Opcional, para proyectos con UI |

### Servidores base

#### Workspace Manager PROJECT (NUEVO)
Servidor MCP stdio. NO sabe de vaults.
- Project: name, root (dónde está el código), agents, memoryNamespace, policies, gates
- Tools: list, current, switch, create, delete, get_agent_config, get_root, duplicate, update, agent_exists
- Persistencia: ~/.backendkit/projects.json

#### Workspace Manager VAULT (EXISTENTE)
- Vaults de conocimiento, cambio de vault (workspace_switch)
- Cada agente tiene su vault global y fijo
- Persistencia: ~/.bk-agent/curator-workspace.json

#### Codex-Context-V2 (EXTENDER)
- 1 LLM de embeddings (nomic-embed-text)
- Índice RAG único con namespaces
- Memoria 3-tier: knowledge, patterns, episodes
- Resolución dual:
  - search_vault() → consulta VAULT MANAGER
  - search_knowledge() → consulta PROJECT MANAGER (memoryNamespace)

## Modelo de datos (projects.json)

{
  "version": "1.0",
  "current": "project-name",
  "projects": {
    "project-name": {
      "name": "Project Name - Backend Core",
      "root": "C:/dev/project-name",
      "agents": {
        "backend": {
          "model": "deepseek-v3",
          "temperature": 0.3,
          "maxTokens": 8000,
          "srcPath": "src",
          "memoryNamespace": "project-name",
          "tools": ["read_file", "write_file", "execute_command", "search_vault", "learn_pattern"]
        },
        "qa": {
          "model": "claude-sonnet",
          "temperature": 0.3,
          "maxTokens": 8000,
          "srcPath": "src",
          "specPath": ".specs",
          "memoryNamespace": "project-name",
          "tools": ["read_file", "write_file", "execute_command", "search_vault", "search_knowledge", "learn_pattern", "remember", "recall"]
        },
        "security": {
          "model": "gpt-4o",
          "temperature": 0.2,
          "maxTokens": 6000,
          "memoryNamespace": "project-name",
          "tools": ["read_file", "search_vault", "save_knowledge", "learn_pattern", "remember", "recall"]
        },
        "design": {
          "model": "deepseek-r1",
          "temperature": 0.7,
          "maxTokens": 8000,
          "specPath": ".specs",
          "memoryNamespace": "project-name",
          "tools": ["read_file", "write_file", "search_vault", "save_knowledge", "search_knowledge", "learn_pattern"]
        },
        "infra": {
          "model": "deepseek-v3",
          "temperature": 0.3,
          "maxTokens": 6000,
          "memoryNamespace": "project-name",
          "tools": ["read_file", "write_file", "execute_command", "search_vault"]
        }
      },
      "policies": { "enabled": ["pr-auth-security-review", "pr-require-tests"] },
      "memory": { "namespace": "project-name", "enabled": true },
      "gates": { "designReview": "human", "securityReview": "auto", "qaApproval": "auto" }
    }
  }
}

## Sistema de Calidad

### Gates
- Gate 1: Design Review (Humano) — después de SPECIFY
- Gate 2: QA por Fase (Automático, QA-MCP independiente) — después de cada fase IMPLEMENT
- Gate 3: Security Review (Automático por Cable 2) — si keywords coinciden
- Gate 4: Humano Final (Opcional) — según criticidad del proyecto

### Policy Rules (Cable 2) — Deterministas, SIN LLM
- pr-auth-security-review: keywords auth/jwt/token → requireSecurityReview
- pr-require-tests: mustInclude tests + mustPass npm test
- pr-schema-review: keywords entity/model → mustExecute migration:validate
- pr-payment-critical: keywords payment/stripe → triple gate (security + QA + human)

## Reflection Engine (MAPE-K)
1. MONITOR: cada gate outcome se registra
2. ANALYZE: busca patrones en failures
3. PLAN: learn_pattern()
4. EXECUTE: si count >= 3 → promote_patterns() → regla automática
5. KNOWLEDGE: la regla se agrega a policies del proyecto

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

---


---

## 2. Workspace Manager v2

### 2.1 ¿Qué es?

Es un **servidor MCP** que centraliza la configuración de proyectos/ámbitos. El orchestrator lo consulta para saber: qué agentes levantar, qué vault usar, qué modelo LLM asignar, qué policies/gates aplican.

No es un "switcher de vault" (eso es concurrentemente peligroso). Es un **proveedor de configuración**.

### 2.2 Modelo de datos

```typescript
// workspace-manager/src/types.ts

interface WorkspaceV2 {
  id: string                              // "proyecto-cliente-x"
  name: string                            // "Cliente X - Backend Core"
  description?: string
  createdAt: string                       // ISO timestamp
  updatedAt: string                       // ISO timestamp
  active: boolean                         // único activo a la vez

  // Configuración de agentes stdio
  agents: {
    [agentId: string]: {                  // "backend", "security", "qa", "design"
      enabled: boolean
      model: string                       // "deepseek-v3" | "gpt-4o" | "claude-sonnet" | ...
      modelConfig?: {
        temperature?: number
        maxTokens?: number
        apiKey?: string                   // o hereda de env
      }
      tools: string[]                     // ["read_file", "write_file", "execute_command", "search_vault", "memory_*"]
      vaultNamespace: string              // "cliente-x/backend"
      systemPromptPath?: string           // path a .md con system prompt custom
    }
  }

  // Políticas de calidad (Cable 2)
  policies: {
    enabled: string[]                     // ["pr-auth-security-review", "pr-require-tests", ...]
    custom?: PolicyRule[]                 // reglas extra específicas del proyecto
  }

  // Memoria compartida
  memory: {
    namespace: string                     // "cliente-x"
    enabled: boolean
  }

  // Gates
  gates: {
    designReview: "auto" | "human" | "disabled"
    securityReview: "auto" | "human" | "disabled"
    qaApproval: "auto" | "human" | "disabled"
    humanApprovers?: string[]             // IDs de usuarios autorizados
  }

  // Metadatos
  metadata?: Record<string, string>
}

interface PolicyRule {
  id: string
  description: string
  if: {
    domain?: string[]
    keywords?: string[]
  }
  then: {
    gates?: string[]
    mustInclude?: string[]
    mustPass?: string[]
    mustExecute?: string[]
    requireSecurityReview?: boolean
    requireQaApproval?: boolean
    requireArchitectureReview?: boolean
  }
}
```

### 2.4 Tools MCP del workspace-manager v2

```typescript
// workspace-manager/src/server.ts

const tools = [
  // === GESTIÓN DE PROYECTOS ===
  {
    name: "workspace_list",
    description: "Lista todos los proyectos/ámbitos disponibles"
  },
  {
    name: "workspace_current",
    description: "Muestra el proyecto activo con toda su configuración"
  },
  {
    name: "workspace_switch",
    description: "Cambia el proyecto activo",
    inputSchema: {
      name: string  // workspace id
    }
  },
  {
    name: "workspace_create",
    description: "Crea un nuevo proyecto/ámbito",
    inputSchema: {
      id: string,
      name: string,
      agents: { ... },     // configuración de agentes
      policies?: string[],
      gates?: { ... }
    }
  },
  {
    name: "workspace_update",
    description: "Actualiza configuración de un proyecto"
  },
  {
    name: "workspace_delete",
    description: "Elimina un proyecto"
  },
  {
    name: "workspace_duplicate",
    description: "Clona un proyecto como base para uno nuevo"
  },

  // === CONSULTA DE CONFIGURACIÓN PARA AGENTES ===
  {
    name: "workspace_agent_config",
    description: "Devuelve la configuración de un agente específico en el proyecto activo",
    inputSchema: {
      agentId: string,       // "backend" | "security" | "qa" | "design"
      workspaceId?: string   // opcional, usa current si no se especifica
    },
    output: {
      model: string,
      tools: string[],
      vaultNamespace: string,
      systemPromptPath?: string
    }
  },

  // === POLÍTICAS ===
  {
    name: "workspace_policies",
    description: "Devuelve las políticas activas para el proyecto actual",
    inputSchema: {
      domain?: string,       // filtrar por dominio
      keywords?: string[]    // filtrar por keywords
    },
    output: PolicyRule[]
  },

  // === GATES ===
  {
    name: "workspace_gate_config",
    description: "Devuelve la configuración de gates para el proyecto activo",
    output: {
      designReview: "auto" | "human" | "disabled",
      securityReview: "auto" | "human" | "disabled",
      qaApproval: "auto" | "human" | "disabled"
    }
  },

  // === MEMORIA ===
  {
    name: "workspace_memory_config",
    description: "Devuelve el namespace de memoria del proyecto activo",
    output: {
      namespace: string,
      enabled: boolean
    }
  }
];
```

### 2.5 Flujo de uso por el orchestrator

```
Orchestrator recibe: "Implementar JWT con refresh para proyecto Cliente X"

PASO 1: Obtener configuración del proyecto
  → workspace_current()
  → Devuelve: { id: "proyecto-cliente-x", agents: {...}, policies: [...], ... }

PASO 2: Para cada agente que va a invocar, consulta su config
  → workspace_agent_config("design")
  → Devuelve: { model: "deepseek-r1", vaultNamespace: "cliente-x/design", ... }

  → workspace_agent_config("backend")
  → Devuelve: { model: "deepseek-v3", vaultNamespace: "cliente-x/backend", ... }

  → workspace_agent_config("qa")
  → Devuelve: { model: "claude-sonnet", vaultNamespace: "cliente-x/qa", ... }

PASO 3: Consulta políticas aplicables
  → workspace_policies({ keywords: ["jwt", "auth"] })
  → Devuelve: [pr-auth-security-review, pr-require-tests]

PASO 4: Ejecuta el flujo SDD usando la config obtenida
  → Invoca a cada agente stdio con los parámetros específicos
  → Cada consulta RAG usa el namespace correspondiente
  → Cada gate evalúa según la configuración del proyecto

PASO 5: Al cambiar de proyecto
  → workspace_switch("proyecto-cliente-y")
  → El orchestrator detiene agentes (opcional), cambia contexto
```

---

## 3. Agentes del Ecosistema

### 3.1 DESIGN-AGENT (MCP stdio)

**Responsabilidad:** Fase SPECIFY del SDD. Genera `specification.md`, `design.md` (ADRs), `ROADMAP.md`.

```typescript
// agents/design-mcp/src/server.ts

const tools = [
  {
    name: "generate_spec",
    description: "Genera specification.md desde un prompt del usuario",
    inputSchema: {
      prompt: string,
      vaultNamespace: string       // "cliente-x/design"
    }
  },
  {
    name: "generate_design",
    description: "Genera design.md con ADRs desde la spec",
    inputSchema: { specPath: string }
  },
  {
    name: "generate_roadmap",
    description: "Genera ROADMAP.md con fases ordenadas desde la spec",
    inputSchema: { specPath: string, designPath: string }
  },
  {
    name: "revise_spec",
    description: "Revisa la spec basado en feedback de QA o humano",
    inputSchema: {
      feedback: string,
      specPath: string
    }
  }
];
```

**Modelo recomentado:** `deepseek-r1` (razonamiento profundo para diseño) o `gpt-4o`.

### 3.2 BACKEND-AGENT (MCP stdio)

**Responsabilidad:** Fase IMPLEMENT del SDD. Lee la spec, implementa código fase por fase.

```typescript
// agents/backend-mcp/src/server.ts

const tools = [
  {
    name: "implement_feature",
    description: "Implementa la feature actual del ROADMAP",
    inputSchema: {
      specPath: string,
      roadmapPath: string,
      currentPhase: number,
      vaultNamespace: string    // "cliente-x/backend"
    }
  },
  {
    name: "read_project_files",
    description: "Lee archivos del proyecto para contexto"
  },
  {
    name: "write_code",
    description: "Escribe código en el proyecto",
    inputSchema: { filePath: string, content: string }
  },
  {
    name: "execute_command",
    description: "Ejecuta comandos en el proyecto"
  }
];
```

**Modelo recomendado:** `deepseek-v3` (rápido y económico para código).

### 3.3 QA-AGENT (MCP stdio) — INDEPENDIENTE

**Responsabilidad:** Fase VERIFY. Valida el código contra `specification.md`. Genera `qa-phaseN.md`. **No es el mismo que implementó.**

```typescript
// agents/qa-mcp/src/server.ts

const tools = [
  {
    name: "run_qa_phase",
    description: "Ejecuta QA de la fase actual contra la spec",
    inputSchema: {
      specPath: string,
      phaseNumber: number,
      codePaths: string[],       // archivos a validar
      vaultNamespace: string,    // "cliente-x/qa"
      designPath?: string        // design.md para validar ADRs
    },
    output: {
      verdict: "GO" | "NO GO" | "CONDITIONAL",
      criteria_results: {
        id: string,
        description: string,
        result: "✅" | "❌" | "⚠️",
        evidence: string
      }[],
      adr_compliance: {
        adr: string,
        result: "✅" | "❌"
      }[],
      findings: {
        severity: "low" | "medium" | "high",
        description: string,
        suggestion?: string
      }[],
      qa_report_path: string    // ruta del qa-phaseN.md generado
    }
  },
  {
    name: "validate_against_spec",
    description: "Valida código específico contra un criterio de la spec",
    inputSchema: {
      specPath: string,
      criterionId: string,
      codePath: string
    }
  },
  {
    name: "generate_tests",
    description: "Genera tests faltantes basados en la spec",
    inputSchema: { specPath: string, codePaths: string[] }
  }
];
```

**Modelo recomendado:** `claude-sonnet` (excelente razonando sobre specs y detectando desviaciones).

### 3.4 SECURITY-AGENT (MCP stdio)

**Responsabilidad:** Revisión de seguridad. Se activa automáticamente por Cable 2 si las keywords del dominio coinciden.

```typescript
// agents/security-mcp/src/server.ts

const tools = [
  {
    name: "security_review",
    description: "Revisa código contra OWASP y mejores prácticas",
    inputSchema: {
      codePaths: string[],
      vaultNamespace: string,   // "cliente-x/security"
      domain: string            // "auth" | "api" | "database" | ...
    },
    output: {
      verdict: "PASS" | "FAIL" | "CONDITIONAL",
      vulnerabilities: {
        severity: "critical" | "high" | "medium" | "low",
        cwe?: string,            // CWE identifier
        description: string,
        filePath: string,
        line?: number,
        recommendation: string
      }[],
      reportPath: string
    }
  }
];
```

**Modelo recomendado:** `gpt-4o` (seguridad crítica requiere precisión máxima).

### 3.5 CÓMO SE COMUNICAN CON CODEX Y MEMORIA

Todos los agentes stdio comparten las mismas tools de vault y memoria, pero cada llamada especifica el **namespace** correspondiente:

```typescript
// EJEMPLO: Backend-agent consultando su vault
codex.search_vault({
  query: "cómo implementar JWT refresh",
  namespace: "cliente-x/backend",    // ← solo su vault
  topK: 5
})

// EJEMPLO: QA-agent validando contra la spec
codex.search_vault({
  query: "criterios de aceptación JWT",
  namespace: "cliente-x/design",     // ← lee el vault del design-agent
  topK: 3
})

// EJEMPLO: Security-agent guardando aprendizaje
memory.save_knowledge({
  content: "JWT debe usar RS256, no HS256. Encontrado en security review del módulo auth.",
  tags: ["jwt", "seguridad", "algoritmo-firma"],
  namespace: "cliente-x"             // ← memoria compartida del proyecto
})
```

---

## 4. Flujo Spec-Driven Development

### 4.1 Fases del SDD

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SPEC-DRIVEN DEVELOPMENT FLOW                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ENTRADA: Usuario da un prompt (ej: "Implementar JWT con refresh")      │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ FASE 0: ORCHESTRATOR PLANIFICA                                  │    │
│  │                                                                  │    │
│  │  1. workspace_current() → obtiene config del proyecto activo    │    │
│  │  2. workspace_policies({keywords: ["jwt","auth"]})              │    │
│  │     → detecta: requireSecurityReview, requireQaApproval          │    │
│  │  3. Planifica subtareas con dependencias                         │    │
│  │  4. Devuelve: plan JSON al Director                             │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ FASE 1: SPECIFY (DESIGN-AGENT)                                  │    │
│  │                                                                  │    │
│  │  1. workspace_agent_config("design")                             │    │
│  │     → modelo: deepseek-r1, vault: "cliente-x/design"            │    │
│  │                                                                  │    │
│  │  2. design-agent.generate_spec({prompt, vaultNamespace})         │    │
│  │     → specification.md generado                                  │    │
│  │                                                                  │    │
│  │  3. design-agent.generate_design({specPath})                     │    │
│  │     → design.md con ADRs (ej: ADR-001: RS256, ADR-002: Redis)   │    │
│  │                                                                  │    │
│  │  4. design-agent.generate_roadmap({specPath, designPath})        │    │
│  │     → ROADMAP.md con fases:                                      │    │
│  │       Fase 1: Estructura base + entities                         │    │
│  │       Fase 2: AuthService + JWT strategy                         │    │
│  │       Fase 3: Refresh token + rotation                            │    │
│  │       Fase 4: Tests unitarios                                     │    │
│  │       Fase 5: Security review                                     │    │
│  │                                                                  │    │
│  │  5. memory.save_knowledge({spec, design, roadmap})               │    │
│  │     namespace: "cliente-x"                                       │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ GATE 1: DESIGN REVIEW                                           │    │
│  │                                                                  │    │
│  │  workspace_gate_config() → designReview: "human"                │    │
│  │                                                                  │    │
│  │  🧑 Humano revisa: ¿La spec cubre todos los casos?               │    │
│  │  → Si ❌: design-agent.revise_spec({feedback})                   │    │
│  │  → Si ✅: CONTINUAR                                              │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ FASE 2: IMPLEMENT (BACKEND-AGENT) — por cada fase del ROADMAP   │    │
│  │                                                                  │    │
│  │  workspace_agent_config("backend")                               │    │
│  │  → modelo: deepseek-v3, vault: "cliente-x/backend"              │    │
│  │                                                                  │    │
│  │  Por cada fase del ROADMAP (de 1 a N):                           │    │
│  │  ┌─────────────────────────────────────────────────────────┐    │    │
│  │  │  backend-agent.implement_feature({                       │    │    │
│  │  │    specPath, roadmapPath, currentPhase: 1,               │    │    │
│  │  │    vaultNamespace: "cliente-x/backend"                   │    │    │
│  │  │  })                                                      │    │    │
│  │  │  → Escribe código en src/                                │    │    │
│  │  │                                                          │    │    │
│  │  │  memory.learn_pattern({                                  │    │    │
│  │  │    trigger: "JWT refresh rotation",                      │    │    │
│  │  │    action: "implementar con family + blacklist",         │    │    │
│  │  │    outcome: "success",                                   │    │    │
│  │  │    namespace: "cliente-x"                                │    │    │
│  │  │  })                                                      │    │    │
│  │  └─────────────────────────────────────────────────────────┘    │    │
│  │                                                                  │    │
│  │  ┌─────────────────────────────────────────────────────────┐    │    │
│  │  │ FASE 2b: QA POR FASE (QA-AGENT INDEPENDIENTE)           │    │    │
│  │  │                                                          │    │    │
│  │  │  workspace_agent_config("qa")                             │    │    │
│  │  │  → modelo: claude-sonnet, vault: "cliente-x/qa"          │    │    │
│  │  │                                                          │    │    │
│  │  │  qa-agent.run_qa_phase({                                 │    │    │
│  │  │    specPath,                                             │    │    │
│  │  │    phaseNumber: 1,                                       │    │    │
│  │  │    codePaths: ["src/auth/entity", "src/auth/dto"],      │    │    │
│  │  │    vaultNamespace: "cliente-x/qa",                      │    │    │
│  │  │    designPath                                            │    │    │
│  │  │  })                                                      │    │    │
│  │  │                                                          │    │    │
│  │  │  → Valida contra specification.md:                       │    │    │
│  │  │    C1: Entidad User tiene campos requeridos ✅           │    │    │
│  │  │    C2: DTOs tienen validación ✅                          │    │    │
│  │  │    C3: ADR-001 respetado (RS256) ✅                       │    │    │
│  │  │                                                          │    │    │
│  │  │  → Genera qa-phase1.md con reporte                       │    │    │
│  │  │                                                          │    │    │
│  │  │  → VEREDICTO:                                            │    │    │
│  │  │    ✅ GO → ORCHESTRATOR avanza a Fase 2 del ROADMAP      │    │    │
│  │  │    ❌ NO GO → ORCHESTRATOR envía feedback a BACKEND      │    │    │
│  │  │              y vuelve a implement_feature                 │    │    │
│  │  └─────────────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ FASE 3: SECURITY REVIEW (automática por Cable 2)               │    │
│  │                                                                  │    │
│  │  workspace_policies({keywords: ["jwt","auth"]})                 │    │
│  │  → pr-auth-security-review está ACTIVA                          │    │
│  │  → requireSecurityReview: true                                  │    │
│  │                                                                  │    │
│  │  workspace_agent_config("security")                              │    │
│  │  → modelo: gpt-4o, vault: "cliente-x/security"                 │    │
│  │                                                                  │    │
│  │  security-agent.security_review({                                │    │
│  │    codePaths: ["src/auth/"],                                    │    │
│  │    vaultNamespace: "cliente-x/security",                        │    │
│  │    domain: "auth"                                               │    │
│  │  })                                                              │    │
│  │  → ✅ PASS: sin vulnerabilidades críticas                       │    │
│  │  → ⚠️ Hallazgo bajo: "Usar rate limiting en /auth/login"       │    │
│  │                                                                  │    │
│  │  memory.save_knowledge({...})                                   │    │
│  │  memory.learn_pattern({...})                                    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ FASE 4: CURAR CONOCIMIENTO + PROMOVER PATRONES                  │    │
│  │                                                                  │    │
│  │  1. codex.curate_for("backend", "src/auth/")                    │    │
│  │     namespace: "cliente-x/backend"                              │    │
│  │                                                                  │    │
│  │  2. codex.curate_for("security", "src/auth/")                   │    │
│  │     namespace: "cliente-x/security"                             │    │
│  │                                                                  │    │
│  │  3. memory.promote_patterns({                                   │    │
│  │     namespace: "cliente-x",                                     │    │
│  │     minCount: 3                                                  │    │
│  │   })                                                             │    │
│  │     → Si hay 3+ patrones similares → promueve a regla           │    │
│  │                                                                  │    │
│  │  4. codex.reindex({namespace: "cliente-x/*"})                   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  SALIDA: Usuario recibe resumen del flujo completo                      │
│  "✅ Módulo JWT implementado: 4 fases completadas,                      │
│    0 vulnerabilidades, 12 tests pasando,                               │
│    conocimiento curado en vault del proyecto"                           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Artefactos generados por proyecto

```
proyecto-cliente-x/
├── .specs/
│   ├── specification.md          ← Requisitos (RF-01 a RF-N)
│   ├── design.md                 ← ADRs, arquitectura
│   └── ROADMAP.md                ← Fases ordenadas
│
├── .qa/
│   ├── qa-phase1.md              ← QA Fase 1
│   ├── qa-phase2.md              ← QA Fase 2
│   ├── ...
│   └── qa-phaseN.md              ← QA Final + VEREDICTO
│
├── src/                          ← Código fuente implementado
│   ├── auth/
│   ├── ...
│   └── ...
│
└── (el vault codex se actualiza automáticamente al curar)
```

---

## 5. Sistema de Calidad (QA + Gates)

### 5.1 Tipos de Gate

```
┌─────────────────────────────────────────────────────────────────┐
│                     SISTEMA DE GATES                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  GATE 1: Design Review                                          │
│  ┌──────────────────────────────────────────────────────┐       │
│  │ ¿Quién evalúa?   🧑 Humano (por defecto)            │       │
│  │ ¿Cuándo?         Después de FASE 1 (SPECIFY)        │       │
│  │ ¿Qué valida?     ¿La spec cubre todos los casos?    │       │
│  │ ¿Config?         workspace_gates.designReview       │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
│  GATE 2: QA por Fase (Automático)                               │
│  ┌──────────────────────────────────────────────────────┐       │
│  │ ¿Quién evalúa?   🤖 QA-AGENT (independiente)        │       │
│  │ ¿Cuándo?         Después de cada fase de IMPLEMENT  │       │
│  │ ¿Qué valida?     Criterios funcionales vs spec + ADRs│      │
│  │ ¿Config?         workspace_gates.qaApproval          │       │
│  │ ¿Si falla?       Vuelve a BACKEND-AGENT con feedback │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
│  GATE 3: Security Review (Automático por Cable 2)               │
│  ┌──────────────────────────────────────────────────────┐       │
│  │ ¿Quién evalúa?   🤖 SECURITY-AGENT                   │       │
│  │ ¿Cuándo?         Si las keywords del dominio activan │       │
│  │                  la policy rule                       │       │
│  │ ¿Qué valida?     OWASP, mejores prácticas            │       │
│  │ ¿Config?         workspace_policies + policy rule   │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
│  GATE 4: Humano Final (Opcional, según criticidad)              │
│  ┌──────────────────────────────────────────────────────┐       │
│  │ ¿Quién evalúa?   🧑 Humano                           │       │
│  │ ¿Cuándo?         Si workspace_gates.humanApproval    │       │
│  │                  = true y hay hallazgos críticos     │       │
│  │ ¿Qué valida?     Todo el entregable                  │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Policy Rules (Cable 2) — Reglas deterministas sin LLM

```yaml
# workspace-manager/policies/default.yaml

policies:
  # REGLA 1: Código de auth requiere security review
  - id: pr-auth-security-review
    description: "Toda tarea que toque autenticación requiere revisión de seguridad"
    if:
      keywords: ["auth", "jwt", "login", "password", "token", "session", "oauth"]
    then:
      requireSecurityReview: true
      gate: true
      criteria:
        - "Verificar algoritmo de firma (debe ser RS256 o superior)"
        - "Verificar que secrets no están hardcodeados"
        - "Verificar rate limiting en endpoints de auth"

  # REGLA 2: Todo código nuevo requiere tests
  - id: pr-require-tests
    description: "Todo código nuevo debe incluir tests"
    then:
      mustInclude: ["*.spec.ts", "*.test.ts"]
      mustPass: ["npm test"]
      gate: true

  # REGLA 3: Cambios en BD requieren validación de migración
  - id: pr-schema-review
    description: "Cambios en entidades requieren revisión de esquema"
    if:
      keywords: ["entity", "model", "schema", "migration", "table"]
    then:
      mustExecute: ["npm run migration:validate"]
      requireArchitectureReview: true
      gate: true

  # REGLA 4: Código de pagos requiere triple gate
  - id: pr-payment-critical
    description: "Código de pagos requiere security + QA + humano"
    if:
      keywords: ["payment", "billing", "subscription", "checkout", "stripe"]
    then:
      requireSecurityReview: true
      requireQaApproval: true
      gate: true
      gate_type: human
```

### 5.3 Formato del reporte QA (qa-phaseN.md)

```markdown
# QA Report - Fase 3: Refresh Token Implementation
**Proyecto:** Cliente X - Backend Core
**Fecha:** 2026-06-20
**Agente:** QA-MCP (claude-sonnet)
**Veredicto:** ✅ GO

## Criterios Funcionales vs Specification.md

| ID | Criterio | Resultado | Evidencia |
|----|----------|-----------|-----------|
| C1 | Refresh token se genera con rotación | ✅ | refresh-token.service.ts L45-67 implementa rotate() |
| C2 | Refresh token expira a los 7 días | ✅ | TTL configurado en 604800 segundos |
| C3 | Blacklist de tokens revocados | ✅ | redis-blacklist.service.ts implementa isRevoked() |
| C4 | No se puede reusar un refresh token | ✅ | rotate() invalida el anterior en la misma transacción |

## Cumplimiento de ADRs (design.md)

| ADR | Estado | Evidencia |
|-----|--------|-----------|
| ADR-001: RS256 | ✅ | jwt.strategy.ts usa RS256 |
| ADR-002: Redis para blacklist | ✅ | redis-blacklist.service.ts |
| ADR-003: Family tokens | ✅ | refresh-token.entity.ts incluye familyId |

## Hallazgos

| Severidad | Descripción | Sugerencia |
|-----------|-------------|------------|
| ⚠️ Baja | No hay rate limiting en /auth/refresh | Agregar @Throttle() del nestjs/throttler |
| ℹ️ Info | Coverage de tests: 72% (mínimo 80%) | Agregar tests para edge cases |

## Tests Ejecutados
- `npm test`: 12 pass, 0 fail
- `npm run lint`: 0 errors, 2 warnings
- Coverage: 72%
```

---

## 6. Memoria Compartida + Codex

### 6.1 Namespaces

```
codex-context-agent-v2
├── LLM embeddings: nomic-embed-text-v1 (único, ~274MB)
├── Cache de embeddings (TTL: 1 hora)
│
├── vaults/{proyecto}/{agente}/
│   ├── cliente-x/backend/*
│   ├── cliente-x/security/*
│   ├── cliente-x/qa/*
│   ├── cliente-x/design/*
│   │
│   ├── cliente-y/backend/*
│   └── cliente-y/qa/*
│
├── memories/{proyecto}/
│   ├── cliente-x/knowledge/*
│   ├── cliente-x/patterns/*
│   ├── cliente-x/episodes/*
│   │
│   ├── cliente-y/knowledge/*
│   └── cliente-y/patterns/*
│
└── knowledge/global/*         ← conocimiento cross-proyecto (opcional)
```

### 6.2 Tools unificadas del codex-context-agent-v2

```typescript
// codex-context-agent-v2/src/server.ts

const tools = [
  // === VAULT ===
  {
    name: "search_vault",
    description: "Busca en el vault de un agente específico",
    inputSchema: {
      query: string,
      namespace: string,       // "cliente-x/backend"
      topK?: number,
      autoSynthesize?: boolean
    }
  },
  {
    name: "curate_for",
    description: "Cura archivos en el vault de un agente",
    inputSchema: {
      namespace: string,       // "cliente-x/backend"
      path: string
    }
  },
  {
    name: "read_note",
    description: "Lee una nota curada del vault",
    inputSchema: {
      namespace: string,
      path_or_title: string
    }
  },
  {
    name: "reindex",
    description: "Reindexa un namespace específico",
    inputSchema: {
      namespace: string        // "cliente-x/*" para todo el proyecto
    }
  },

  // === MEMORIA SEMÁNTICA ===
  {
    name: "save_knowledge",
    description: "Guarda un hecho/decision/arquitectura",
    inputSchema: {
      content: string,
      tags: string[],
      namespace: string,       // "cliente-x"
      domain?: string          // "backend" | "cross-domain" | ...
    }
  },
  {
    name: "search_knowledge",
    description: "Busca conocimiento semántico",
    inputSchema: {
      query: string,
      namespace: string,
      domain?: string
    }
  },

  // === MEMORIA PROCEDURAL ===
  {
    name: "learn_pattern",
    description: "Registra un patrón que funcionó o falló",
    inputSchema: {
      trigger: string,
      action: string,
      outcome: "success" | "failure",
      namespace: string,
      domain?: string
    }
  },
  {
    name: "search_patterns",
    description: "Busca patrones por trigger",
    inputSchema: {
      trigger?: string,
      namespace: string,
      minCount?: number
    }
  },
  {
    name: "promote_patterns",
    description: "Promueve patrones con count>=3 a reglas automáticas",
    inputSchema: {
      namespace: string,
      minCount?: number        // default 3
    }
  },

  // === MEMORIA EPISÓDICA ===
  {
    name: "remember",
    description: "Guarda una experiencia/incidente",
    inputSchema: {
      content: string,
      tags: string[],
      severity: "info" | "warning" | "critical",
      namespace: string
    }
  },
  {
    name: "recall",
    description: "Busca experiencias pasadas relevantes",
    inputSchema: {
      query: string,
      namespace: string,
      severity?: string,
      limit?: number
    }
  }
];
```

### 6.3 Integración con workspace-manager para namespaces

```typescript
// orchestrator-agent ejecuta:

async function invokeAgent(agentId: string, tool: string, args: any) {
  // 1. Obtener config del agente en el proyecto activo
  const config = await workspaceManager.workspace_agent_config({
    agentId,  // "backend"
    workspaceId: currentWorkspace  // "cliente-x"
  });

  // 2. Inyectar namespace en todos los argumentos
  const argsWithNamespace = {
    ...args,
    namespace: config.vaultNamespace,  // "cliente-x/backend"
    model: config.model                // "deepseek-v3"
  };

  // 3. Invocar al agente stdio
  return await agentPool.callAgent(agentId, tool, argsWithNamespace);
}

// El agente nunca sabe en qué proyecto está.
// Solo recibe: namespace y modelo.
// El orchestrator lo abstrae completamente.
```

---

## 7. Reflection Engine (MAPE-K)

### 7.1 Cómo funciona

```
                    ┌──────────────────────────────────────┐
                    │          MONITOR                      │
                    │  Cada gate outcome se registra:       │
                    │  ✅ GO / ❌ NO GO / ⚠️ CONDITIONAL    │
                    │  + motivo, agente, dominio            │
                    │  + namespace del proyecto              │
                    └────────────────┬─────────────────────┘
                                    │
                    ┌───────────────▼──────────────────────┐
                    │          ANALYZE                      │
                    │  Busca patrones en los failures:      │
                    │  "En 4 de 5 tareas de backend que     │
                    │   tocaban SQL, OLVIDARON usar         │
                    │   parámetros parametrizados"           │
                    │  namespace: "cliente-x"               │
                    └────────────────┬─────────────────────┘
                                    │
                    ┌───────────────▼──────────────────────┐
                    │          PLAN                         │
                    │  "Propongo crear policy rule:         │
                    │   SI keywords contiene 'query'        │
                    │   THEN mustPass: npm run lint         │
                    │   -rule sql-injection"                 │
                    │  namespace: "cliente-x"               │
                    └────────────────┬─────────────────────┘
                                    │
                    ┌───────────────▼──────────────────────┐
                    │          EXECUTE                      │
                    │  memory.learn_pattern({               │
                    │    trigger: "SQL query concatenado",  │
                    │    action: "usar parámetros",         │
                    │    outcome: "failure",                │
                    │    namespace: "cliente-x"             │
                    │  })                                   │
                    │                                       │
                    │  Si count >= 3 en el namespace:       │
                    │  → memory.promote_patterns()          │
                    │  → Se agrega regla al workspace       │
                    └────────────────┬─────────────────────┘
                                    │
                    ┌───────────────▼──────────────────────┐
                    │          KNOWLEDGE                    │
                    │  La regla ya está en el sistema.      │
                    │  PRÓXIMA VEZ: cuando backend-agent    │
                    │  toque SQL, el gate activa la regla   │
                    │  automáticamente SIN LLM.             │
                    │  El error NO se repite.               │
                    └──────────────────────────────────────┘
```

### 7.2 Promoción de patrones a reglas

```typescript
// codex-context-agent-v2/src/reflection.ts

async function promotePatterns(namespace: string, minCount: number = 3) {
  // 1. Buscar patrones con count >= minCount en el namespace
  const patterns = await memory.search_patterns({
    namespace,
    minCount
  });

  for (const pattern of patterns) {
    if (pattern.promoted) continue;  // ya fue promovido

    // 2. Convertir el patrón en una policy rule
    const newRule: PolicyRule = {
      id: `auto-${pattern.id}`,
      description: `Regla automática: ${pattern.action}`,
      if: {
        keywords: pattern.trigger.split(' ')
      },
      then: {
        mustInclude: pattern.outcome === 'failure'
          ? [pattern.action]
          : undefined
      }
    };

    // 3. Agregar la regla al workspace del proyecto
    await workspaceManager.workspace_add_policy({
      workspaceId: namespace.split('/')[0],  // "cliente-x"
      rule: newRule
    });

    // 4. Marcar como promovido
    await memory.mark_pattern_promoted({
      patternId: pattern.id,
      namespace
    });

    // 5. Registrar en memoria episódica
    await memory.remember({
      content: `Patrón "${pattern.trigger}" promovido a regla automática`,
      severity: "info",
      tags: ["reflection", "pattern-promoted"],
      namespace
    });
  }
}
```

---

## 8. Especificación de Tools MCP

### 8.1 Resumen de todos los servidores MCP

| Servidor MCP | Tipo | Tools | Propósito |
|---|---|---|---|
| **orchestrator-agent** | stdio | `start_flow`, `run_status`, `orchestrator_approve`, `orchestrator_reject`, `orchestrator_retry` | Planificar y coordinar flujos SDD |
| **design-mcp** | stdio | `generate_spec`, `generate_design`, `generate_roadmap`, `revise_spec` | Fase SPECIFY |
| **backend-mcp** | stdio | `implement_feature`, `read_project_files`, `write_code`, `execute_command` | Fase IMPLEMENT |
| **qa-mcp** | stdio | `run_qa_phase`, `validate_against_spec`, `generate_tests` | Fase QA independiente |
| **security-mcp** | stdio | `security_review` | Fase SECURITY REVIEW |
| **codex-context-v2** | stdio | `search_vault`, `curate_for`, `read_note`, `save_knowledge`, `search_knowledge`, `learn_pattern`, `search_patterns`, `remember`, `recall`, `promote_patterns`, `reindex` | Vault + Memoria unificados |
| **workspace-manager-v2** | stdio | `workspace_list`, `workspace_current`, `workspace_switch`, `workspace_create`, `workspace_agent_config`, `workspace_policies`, `workspace_gate_config`, `workspace_memory_config` | Gestión de proyectos/ámbitos |

### 8.2 Comunicación entre servidores

```
DIRECTOR
  │
  ├── mcp__orchestrator__start_flow({ flow_id, input })
  │     │
  │     ├── mcp__workspace__workspace_current()
  │     ├── mcp__workspace__workspace_agent_config("backend")
  │     ├── mcp__workspace__workspace_policies({keywords})
  │     │
  │     ├── child_process → design-mcp (pipe stdin/stdout)
  │     │     └── usa mcp__codex__search_vault({namespace: "cliente-x/design"})
  │     │
  │     ├── child_process → backend-mcp (pipe stdin/stdout)
  │     │     └── usa mcp__codex__search_vault({namespace: "cliente-x/backend"})
  │     │     └── usa mcp__codex__save_knowledge({namespace: "cliente-x"})
  │     │
  │     ├── child_process → qa-mcp (pipe stdin/stdout)
  │     │     └── usa mcp__codex__search_vault({namespace: "cliente-x/design"})
  │     │     └── usa mcp__codex__search_knowledge({namespace: "cliente-x"})
  │     │
  │     └── child_process → security-mcp (pipe stdin/stdout)
  │           └── usa mcp__codex__search_vault({namespace: "cliente-x/security"})
  │           └── usa mcp__codex__learn_pattern({namespace: "cliente-x"})
  │
  └── resultado al usuario
```

---

## 9. Modelo de Configuración

### 9.1 Archivo de configuración principal

```yaml
# ~/.backendkit/config.yaml

version: "2.0"

# Proyecto activo
active_workspace: "proyecto-cliente-x"

# Servidores MCP globales (siempre activos)
servers:
  codex:
    type: stdio
    command: node
    args: ["agents/codex-context-v2/dist/server.js"]

  workspace-manager:
    type: stdio
    command: node
    args: ["agents/workspace-manager-v2/dist/server.js"]

# Pool de agentes stdio (el orchestrator los levanta bajo demanda)
agent_pool:
  max_instances: 6         # máx agentes simultáneos
  idle_timeout_ms: 30000   # matar agente si está inactivo 30s
  health_check_interval: 15000  # cada 15s

  # Plantillas de agentes (se instancian con la config del workspace)
  templates:
    design:
      command: node
      args: ["agents/design-mcp/dist/server.js"]
      default_model: "deepseek-r1"

    backend:
      command: node
      args: ["agents/backend-mcp/dist/server.js"]
      default_model: "deepseek-v3"

    qa:
      command: node
      args: ["agents/qa-mcp/dist/server.js"]
      default_model: "claude-sonnet"

    security:
      command: node
      args: ["agents/security-mcp/dist/server.js"]
      default_model: "gpt-4o"
```

### 9.2 Archivo de workspaces (gestionado por workspace-manager)

```json
// ~/.backendkit/workspaces.json
// (Ver sección 2.3 para el schema completo)
```

---

## 10. Estrategia de Despliegue

### 10.1 Desarrollo local

```bash
# Un solo comando
coder-dev up

# Levanta:
# 1. codex-context-agent-v2 (servidor MCP stdio) → ~274MB RAM
# 2. workspace-manager-v2 (servidor MCP stdio) → ~50MB RAM
# 3. orchestrator-agent (proceso principal) → ~100MB RAM
# 4. design-mcp (bajo demanda, child process) → ~100MB c/u
# 5. backend-mcp (bajo demanda, child process) → ~100MB c/u
# 6. qa-mcp (bajo demanda, child process) → ~100MB c/u
# 7. security-mcp (bajo demanda, child process) → ~100MB c/u
#
# RAM total con 3 agentes activos: ~700MB
# RAM total con todos activos: ~1GB
```

### 10.2 Producción (Docker Compose)

```yaml
# docker-compose.yml
version: "3.8"
services:
  orchestrator:
    build: ./orchestrator
    ports: ["3400:3400"]
    volumes:
      - workspace-data:/home/app/.backendkit
    environment:
      - CODEX_SERVER=codex:3456
      - WORKSPACE_SERVER=workspace-manager:3457
    depends_on: [codex, workspace-manager]

  codex:
    build: ./codex-context-v2
    ports: ["3456:3456"]
    volumes:
      - codex-data:/home/app/.backendkit/vaults
      - memory-data:/home/app/.backendkit/memories

  workspace-manager:
    build: ./workspace-manager-v2
    ports: ["3457:3457"]
    volumes:
      - workspace-data:/home/app/.backendkit
```

---

## Resumen de lo que logramos con este diseño

| Problema original | Solución en Coder v2 |
|---|---|
| **QA lo hace el mismo que implementó** | ✅ QA-AGENT independiente, sin sesgo de confirmación |
| **Contexto contaminado entre roles** | ✅ Cada agente stdio tiene su propio proceso, contexto aislado |
| **Vault único con 500+ notas mezcladas** | ✅ Vaults por namespace (`cliente-x/backend`, `cliente-x/security`) |
| **Sin aislamiento de proyectos** | ✅ Workspace Manager v2: proyectos independientes con su config |
| **Sin gates automáticos** | ✅ Cable 2: policy rules deterministas SIN LLM |
| **Aprendizaje no cruzaba dominios** | ✅ Memoria compartida por namespace: semántica + procedural + episódica |
| **Sin paralelismo real** | ✅ Cada agente stdio es un proceso del SO, multiproceso real |
| **Un solo modelo LLM para todo** | ✅ Cada agente con el modelo óptimo para su dominio |
| **Sin especificación previa al código** | ✅ SDD: spec → design → roadmap → implement → QA |
| **Sin persistencia de decisiones** | ✅ `memory.save_knowledge()` + `memory.learn_pattern()` + `vault curation` |

---