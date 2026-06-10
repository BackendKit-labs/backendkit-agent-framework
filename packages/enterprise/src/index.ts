export { ObsidianRAGProvider } from './rag/ObsidianRAGProvider';
export type { ObsidianRAGOptions } from './rag/ObsidianRAGProvider';

export { OllamaEmbedder, OLLAMA_EMBED_DEFAULT_HOST, OLLAMA_EMBED_DEFAULT_MODEL } from './rag/OllamaEmbedder';
export type { OllamaEmbedderOptions } from './rag/OllamaEmbedder';

export { VectorStore } from './rag/VectorStore';
export type { VectorChunk, SearchResult } from './rag/VectorStore';

export { VaultIndexer } from './rag/VaultIndexer';
export type { IndexerOptions, RawChunk } from './rag/VaultIndexer';

export { VaultWriter } from './rag/VaultWriter';
export type { VaultWriterOptions, WriteNoteParams } from './rag/VaultWriter';
