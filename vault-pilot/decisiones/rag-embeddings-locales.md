---
title: "Decisión: RAG con Embeddings 100% Locales"
date: 2026-06-01
tags: ["área/rag", "tipo/decisión", "stack/typescript"]
description: "Por qué usamos nomic-embed-text en Ollama en vez de servicios externos"
---

## Contexto

El RAG necesita convertir texto en vectores para hacer búsqueda semántica.
Las opciones eran: OpenAI Embeddings API, Cohere, HuggingFace inference, o Ollama local.

## Decisión tomada

Ollama con `nomic-embed-text` como modelo de embeddings por defecto.

## Razones

1. **On-premise obligatorio**: el cliente no puede enviar contenido de su vault a APIs externas.
2. **nomic-embed-text produce vectores de 768 dimensiones** con calidad comparable a modelos más grandes para búsqueda semántica en español y inglés.
3. **Coseno similarity** sobre 768 dims en memoria es suficientemente rápido para vaults de hasta ~10.000 chunks.
4. **Indexado incremental por mtime**: solo se re-embeden archivos nuevos o modificados. Un vault de 300 notas indexa en <2 minutos la primera vez, <5 segundos en actualizaciones.

## Modelo alternativo

`mxbai-embed-large` (1024 dims) si se necesita mayor precisión semántica.
Se configura con `embeddingModel: 'mxbai-embed-large'` en ObsidianRAGOptions.

## Limitaciones conocidas

- El VectorStore es JSON en disco, no es una base vectorial. Para >50.000 chunks,
  evaluar Qdrant o Chroma con adaptador.
- No hay soporte aún para búsqueda híbrida (semántica + keyword BM25).
