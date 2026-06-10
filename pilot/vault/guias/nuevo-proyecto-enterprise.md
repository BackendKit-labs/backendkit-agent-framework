---
title: "Guía: Arrancar un proyecto de agentes enterprise"
date: 2026-06-01
tags: ["área/guía", "tipo/how-to", "stack/enterprise"]
description: "Pasos para configurar un nuevo proyecto de agentes enterprise con BackendKit"
---

## Checklist de arranque

### 1. Definir el dominio y los agentes

- ¿Cuántas áreas funcionales tiene el proyecto? (RRHH, ventas, finanzas, ops...)
- ¿Qué datos son sensibles? → esos agentes van con `provider: 'local'`
- ¿Necesita orquestador? → si hay 2+ áreas, sí

### 2. Crear la estructura del vault

```
vault/
  docs/         ← pedir al cliente los documentos internos relevantes
  decisiones/   ← empezar vacío, ir llenando durante el proyecto
  agentes/      ← vacío, los agentes lo llenarán
```

### 3. Configurar el engine mínimo

```typescript
// Mínimo viable para un proyecto enterprise
const rag = new ObsidianRAGProvider({
  vaultPath: process.env.VAULT_PATH,
  embedder: new SimpleEmbedder(),  // sin Ollama para empezar
  topK: 5,
  minScore: 0.1,
});
await rag.index({ verbose: true });

const writer = new VaultWriter({ vaultPath: process.env.VAULT_PATH });

const tools = new ToolRegistry();
tools.register(rag.createTool());
tools.register(writer.createTool('consultant'));
```

### 4. Definir los agent profiles

Un perfil mínimo viable:

```typescript
const CONSULTANT: AgentProfile = {
  id: 'consultant',
  name: 'Enterprise Consultant',
  description: 'Responde consultas usando el vault del proyecto como base de conocimiento.',
  systemPrompt: `Eres un consultor especializado en [DOMINIO DEL CLIENTE].

Siempre busca en el vault antes de responder usando search_knowledge.
Si encuentras información relevante, cítala en tu respuesta.
Si tomas una decisión importante o encuentras algo no documentado, escríbelo
al vault usando write_knowledge para que otros agentes y el equipo lo encuentren.`,
  allowedTools: ['search_knowledge', 'write_knowledge'],
};
```

### 5. Cargar contenido al vault

Antes de la primera demo:
- Subir 5-10 documentos del negocio del cliente en `docs/`
- Crear al menos una nota en `decisiones/` con una decisión técnica
- Indexar: `await rag.index({ verbose: true })`

### 6. Validar que el RAG funciona

Probar que el agente encuentra información del vault:
```
> ¿Cuál es la política de [algo que está documentado]?
[agente debería llamar search_knowledge y citar la fuente]
```

Si no encuentra nada → revisar `minScore`, verificar que el indexado completó,
confirmar que las notas tienen contenido (no están vacías).

## Variables de entorno mínimas

```env
DEEPSEEK_API_KEY=sk-...
VAULT_PATH=/ruta/al/vault
# Opcional:
LLM_MODEL=deepseek-chat
```

## Próximos pasos una vez el piloto funciona

1. Agregar más agentes especialistas según el dominio
2. Subir más documentación del cliente al vault
3. Reemplazar SimpleEmbedder por OllamaEmbedder para mejor calidad de búsqueda
4. Agregar tools de integración (CRM, ERP) vía MCP plugins
