# SPEC-0033: RAG genérico (contratos, embeddings, reranking y almacenes)

**Fecha:** 2026-11-17
**Estado:** Borrador. Decisiones D1-D6 con propuesta; sin implementar. **Amplía [SPEC-0017](SPEC-0017-un-contrato-por-concepto.md) F5**, que plantea el contrato; esta spec añade lo que la comparación mostró que falta alrededor de él.
**Origen:** [SPEC-0025](SPEC-0025-mejoras-tras-comparar-con-otros-frameworks.md). Mastra tiene `rag`, `vector` y `fastembed`; el AI SDK de Vercel documenta embeddings y reranking como piezas propias.
**Depende de:** SPEC-0017 F5 (la pregunta de si hay un paquete `agent-rag`); esta spec propone la respuesta.
**Tipo de cambio:** aditivo en un paquete nuevo; `agent-enterprise` pasa a usarlo sin cambiar su API pública.
**Objetivo:** que cualquier agente pueda recuperar conocimiento de **cualquier fuente** (carpeta, base de datos, documentos de `document-extract`) con embeddings intercambiables, un almacén intercambiable y un reranking opcional, y que el RAG de un vault de Obsidian sea un caso de uso, no el único.

## 1. De dónde se parte

Verificado el 2026-11-17:

- `agent-enterprise` (`packages/enterprise/src/rag`): `ObsidianRAGProvider`, `VaultIndexer`, `VaultWriter`, `OllamaEmbedder`, `SimpleEmbedder` y `VectorStore`. Hay una interfaz `Embedder` (en `ObsidianRAGProvider.ts`), pero **el almacén no tiene contrato**: `VectorStore` es una clase que guarda todos los fragmentos en un archivo JSON y busca por coseno recorriéndolos todos.
- El fragmento (`VectorChunk`) está atado al vault: `filePath`, `title`, `section`, y metadatos `area` y `stack`. No sirve tal cual para otra fuente.
- La memoria semántica de core (`agent-memory/SemanticMemory`) tiene su propia comparación por coseno y un `embedFn`, separada de la anterior.
- `orchestrator-agent` tiene su propio RAG con LanceDB (según SPEC-0017 F5). `mcp-server` tiene un indexador de código con tree-sitter, que es un grafo, no vectores.
- No hay reranking ni un recorte por fragmentos configurable en los contratos.

## 2. Evidencia en la competencia

Mastra, commit `35745537`: `packages/rag`, `packages/core/src/vector`, `packages/fastembed` (embeddings locales), `packages/core/src/relevance` (`relevance-score-provider`, un reranker) y `knowledge` (`semantic.ts`, `reembed.ts`: volver a calcular los embeddings cuando cambia el modelo). Vercel `ai`, commit `486e08f`, documentación: `content/docs/03-ai-sdk-core/30-embeddings.mdx` y `31-reranking.mdx`.

## 3. Decisiones

| # | Pregunta | Propuesta |
|---|---|---|
| D1 | ¿Paquete? | **`@backendkit-labs/agent-rag`**, la respuesta afirmativa a SPEC-0017 F5. Contratos y utilidades; sin dependencias pesadas. |
| D2 | ¿Qué contratos? | `Embedder` (`embed(texts) => number[][]`, `dimensions`, `modelId`), `VectorStore` (`upsert`, `query`, `delete`, `count`, con filtro por metadatos y por `tenantId`), `Retriever` (`retrieve(query, opts) => Passage[]`) y `Reranker` (`rerank(query, passages) => Passage[]`). |
| D3 | ¿Qué es un fragmento? | **`Passage` genérico:** `{ id, text, source, metadata: Record<string, string \| number> }`. El vault añade sus campos en `metadata`. |
| D4 | ¿Qué almacenes? | En el paquete, uno **en memoria** y uno **en archivo** (el de hoy, con otro formato de fragmento). En paquetes aparte: SQLite y pgvector (comparten el cliente SQL de [SPEC-0028](SPEC-0028-journals-en-sqlite-y-postgres.md)). LanceDB, como adaptador del `orchestrator-agent` existente. |
| D5 | ¿Aislamiento? | **El filtro por `tenantId` y por carpeta/área es parte del contrato, no del adaptador**: una consulta sin filtro obligatorio en un almacén multi-tenant falla. Es lo que `agent-enterprise` ya promete (aislamiento por carpeta). |
| D6 | ¿Cambio de modelo de embeddings? | **Se guarda `modelId` y `dimensions` en el almacén;** al abrir con otro modelo, falla con un mensaje claro y ofrece `reindex`. Mezclar dimensiones en silencio es el error más caro. |

## 4. Diseño

```ts
const retriever = createRetriever({
  embedder: ollamaEmbedder,
  store: new FileVectorStore('./index'),
  reranker: optionalReranker,            // opcional
});

const passages = await retriever.retrieve('política de vacaciones', { topK: 8, filter: { area: 'rrhh' }, tenantId });
```

- `agent-enterprise` sigue exponiendo `ObsidianRAGProvider` con la misma API; por dentro usa un `Retriever` y un `FileVectorStore`.
- La memoria semántica de core puede aceptar un `Embedder` del mismo contrato en lugar de su `embedFn` suelto (cambio compatible hacia atrás).
- Una tool lista para registrar, `search_knowledge`, `readOnly`, con el filtro de tenant puesto por el engine y no por el modelo.

## 5. Fases

- **F0. Inventario y medición.** Releer las cuatro implementaciones (enterprise, `SemanticMemory`, `orchestrator-agent`, indexador de `mcp-server`); medir la búsqueda lineal de `VectorStore` con 1.000, 10.000 y 100.000 fragmentos para fijar a partir de cuándo hace falta un almacén indexado.
- **F1. Contratos y almacenes en memoria y archivo,** con una batería común de pruebas (como la de journals en SPEC-0028). Prueba: dos implementaciones pasan la misma batería.
- **F2. Migrar `agent-enterprise`** al paquete, sin cambiar su API ni sus pruebas.
- **F3. `modelId` y `dimensions` (D6).** Prueba: abrir un índice con otro modelo falla con el mensaje esperado.
- **F4. Aislamiento (D5).** Prueba: dos tenants con el mismo texto no se ven entre sí; una consulta sin filtro obligatorio falla.
- **F5. Reranker** con una implementación simple (puntuación léxica) y el contrato abierto a uno con modelo.
- **F6. SQLite y pgvector** sobre el cliente de SPEC-0028.
- **F7. Documentación,** con la guía "dar conocimiento a un agente" en la web.

## 6. Criterios de aceptación

- `agent-enterprise` pasa su suite actual sin cambios de prueba.
- Un índice nunca mezcla dimensiones de embeddings.
- Una consulta de un tenant no puede devolver nada de otro, probado.

## 7. Riesgos y fuera de alcance

- La fusión de cuatro RAG a la vez es el riesgo: se hace por fases y empieza por los contratos.
- Fuera de alcance: el indexador de código con tree-sitter (otro concepto, según SPEC-0017), la generación de respuestas (eso es del agente) y los conectores de ingestión (PDF, Word: ya los cubre `document-extract`).
