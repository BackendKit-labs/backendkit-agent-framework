---
title: "Decisión: Estrategia de proveedores LLM"
date: 2026-06-01
tags: ["área/arquitectura", "tipo/decisión", "stack/llm"]
description: "Cuándo usar DeepSeek, Ollama o Anthropic para agentes enterprise"
---

## Contexto

Los proyectos enterprise tienen distintos requisitos de privacidad, costo y capacidad
de razonamiento según el agente. No hay un único proveedor óptimo para todos los casos.

## Decisión

Estrategia híbrida por agente usando `AgentProfile.provider`:

| Caso de uso | Proveedor | Razón |
|---|---|---|
| Datos sensibles (RRHH, finanzas, legal) | Ollama local | Nunca salen de la empresa |
| Razonamiento complejo, redacción | DeepSeek / Anthropic | Mejor calidad |
| Volumen alto, consultas simples | DeepSeek | Costo/rendimiento |
| Sin internet / compliance estricto | Ollama local | Control total |
| Embeddings RAG | nomic-embed-text via Ollama | Local, sin costo por token |

## Implementación

```typescript
const engine = createBaseEngine({
  providers: {
    deepseek: new DeepSeekProvider({ apiKey: process.env.DEEPSEEK_API_KEY }),
    local: new OllamaProvider({ host: 'http://localhost:11434', model: 'llama3.2:3b' }),
  },
  defaultProvider: 'deepseek',
  agents: [
    { id: 'hr-agent',    provider: 'local',    ... },  // dato sensible → nunca sale
    { id: 'sales-agent', provider: 'deepseek', ... },  // razonamiento → cloud OK
  ],
});
```

## Trade-offs

- Ollama requiere GPU para modelos >7B; modelos 3B-8B corren en CPU pero con mayor latencia
- DeepSeek tiene el mejor ratio costo/rendimiento para redacción, búsqueda y coding
- Anthropic Claude es el más capaz para razonamiento multi-paso y escritura de calidad
- SimpleEmbedder (TF-IDF) funciona sin Ollama para proyectos piloto; producción usa nomic-embed-text

## Regla de oro

Si el dato toca a una persona (empleado, cliente, paciente) → Ollama local.
Si el agente necesita razonar sobre sistemas, código o texto libre → cloud.
