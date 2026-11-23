/**
 * The key of `ToolDefinition.meta` where a tool declares the verb it performs ("buy", "sign"), in the vocabulary of the credentials that
 * empower it. `meta` is the framework's slot for metadata of governance clients; the engine never reads it. It is a convention between a
 * tool and whatever provider adapter speaks in verbs: a provider that names tools directly does not need it.
 */
export const CAPABILITY_META_KEY = 'capability';
