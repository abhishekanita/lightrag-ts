// namespace.ts

export class NameSpace {
	static readonly KV_STORE_FULL_DOCS = 'full_docs';
	static readonly KV_STORE_TEXT_CHUNKS = 'text_chunks';
	static readonly KV_STORE_LLM_RESPONSE_CACHE = 'llm_response_cache';

	static readonly VECTOR_STORE_ENTITIES = 'entities';
	static readonly VECTOR_STORE_RELATIONSHIPS = 'relationships';
	static readonly VECTOR_STORE_CHUNKS = 'chunks';

	static readonly GRAPH_STORE_CHUNK_ENTITY_RELATION = 'chunk_entity_relation';

	static readonly DOC_STATUS = 'doc_status';
}

export function makeNamespace(prefix: string, baseNamespace: string): string {
	return prefix + baseNamespace;
}

export function isNamespace(
	namespace: string,
	baseNamespace: string | Iterable<string>,
): boolean {
	if (typeof baseNamespace === 'string') {
		return namespace.endsWith(baseNamespace);
	}

	return Array.from(baseNamespace).some((ns) => isNamespace(namespace, ns));
}
