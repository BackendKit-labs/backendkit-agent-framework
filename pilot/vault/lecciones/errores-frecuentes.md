---
title: "Lecciones: Errores frecuentes en proyectos de agentes enterprise"
date: 2026-06-01
tags: ["área/calidad", "tipo/lección", "stack/agentes"]
description: "Errores que se repiten en implementaciones enterprise y cómo evitarlos"
---

## Error 1: System prompt demasiado largo

**Qué pasa:** se mete todo el contexto del negocio en el system prompt. El agente
ignora las partes al final (lost in the middle). La ventana de contexto se agota.

**Solución:** el system prompt define el rol y las reglas. El conocimiento del negocio
va en el vault → el agente lo busca con `search_knowledge` cuando lo necesita.

---

## Error 2: Tools no granulares

**Qué pasa:** una tool hace demasiadas cosas → el LLM no sabe cuándo usarla,
los errores son difíciles de aislar.

**Solución:** una tool = una acción específica. `get_employee_info` y `update_employee_status`
son dos tools distintas, no una tool con un parámetro `action`.

---

## Error 3: No re-indexar el vault después de que el agente escribe

**Qué pasa:** el agente escribe una nota con `write_knowledge`. En la misma sesión
otro agente busca esa información y no la encuentra porque el índice no se actualizó.

**Solución:** llamar `await rag.index()` después de cada `write_knowledge` si se
espera que otros agentes necesiten esa información en la misma sesión.

---

## Error 4: Agente con demasiadas tools

**Qué pasa:** el agente tiene 15+ tools. El LLM elige la tool incorrecta, el token
budget se consume en el schema de tools, la latencia sube.

**Solución:** máximo 8-10 tools por agente. Si hay más, separar en agentes especialistas.
Usar skills (código determinista) para lógica que no necesita razonamiento LLM.

---

## Error 5: No separar datos sensibles por agente

**Qué pasa:** el HR Agent tiene acceso a las herramientas de finanzas porque "algún
día puede necesitarlas". Los datos de empleados pasan por el proveedor cloud.

**Solución:** principio de mínimo privilegio. `allowedTools` en el `AgentProfile` es
la lista de herramientas a las que el agente puede acceder — nada más. Datos sensibles
→ proveedor local siempre.

---

## Error 6: Ignorar el minScore en RAG

**Qué pasa:** con `minScore: 0` el agente recibe chunks completamente irrelevantes.
El LLM intenta responder con basura y alucina.

**Solución:** empezar con `minScore: 0.3` para Ollama embeddings, `minScore: 0.1` para
SimpleEmbedder (TF-IDF). Si hay pocas notas y los resultados son vacíos, bajar a 0.15.

---

## Error 7: Confiar en que el LLM siempre llamará search_knowledge

**Qué pasa:** el agente tiene acceso al vault pero el LLM responde sin buscarlo.
La respuesta es genérica, sin contexto del negocio.

**Solución:** en el system prompt explicitar cuándo buscar:
> "Siempre busca en el vault antes de responder. Si no encuentras contexto relevante,
> dilo explícitamente antes de responder con conocimiento general."
