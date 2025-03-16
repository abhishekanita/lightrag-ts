/**
 * Knowledge Graph implementations and storage registry
 */

/**
 * Configuration for storage implementations
 */
export const STORAGE_IMPLEMENTATIONS: Record<
	string,
	{
		implementations: string[];
		required_methods: string[];
	}
> = {
	KV_STORAGE: {
		implementations: [
			'JsonKVStorage',
			'MongoKVStorage',
			'RedisKVStorage',
			'TiDBKVStorage',
			'PGKVStorage',
			'OracleKVStorage',
		],
		required_methods: ['getById', 'upsert'],
	},
	GRAPH_STORAGE: {
		implementations: [
			'NetworkXStorage',
			'Neo4JStorage',
			'MongoGraphStorage',
			'TiDBGraphStorage',
			'AGEStorage',
			'GremlinStorage',
			'PGGraphStorage',
			'OracleGraphStorage',
		],
		required_methods: ['upsertNode', 'upsertEdge'],
	},
	VECTOR_STORAGE: {
		implementations: [
			'NanoVectorDBStorage',
			'MilvusVectorDBStorage',
			'ChromaVectorDBStorage',
			'TiDBVectorDBStorage',
			'PGVectorStorage',
			'FaissVectorDBStorage',
			'QdrantVectorDBStorage',
			'OracleVectorDBStorage',
			'MongoVectorDBStorage',
		],
		required_methods: ['query', 'upsert'],
	},
	DOC_STATUS_STORAGE: {
		implementations: [
			'JsonDocStatusStorage',
			'PGDocStatusStorage',
			'PGDocStatusStorage',
			'MongoDocStatusStorage',
		],
		required_methods: ['getDocsByStatus'],
	},
};

/**
 * Storage implementation environment variable requirements
 */
export const STORAGE_ENV_REQUIREMENTS: Record<string, string[]> = {
	// KV Storage Implementations
	JsonKVStorage: [],
	MongoKVStorage: [],
	RedisKVStorage: ['REDIS_URI'],
	TiDBKVStorage: ['TIDB_USER', 'TIDB_PASSWORD', 'TIDB_DATABASE'],
	PGKVStorage: ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DATABASE'],
	OracleKVStorage: [
		'ORACLE_DSN',
		'ORACLE_USER',
		'ORACLE_PASSWORD',
		'ORACLE_CONFIG_DIR',
	],
	// Graph Storage Implementations
	NetworkXStorage: [],
	Neo4JStorage: ['NEO4J_URI', 'NEO4J_USERNAME', 'NEO4J_PASSWORD'],
	MongoGraphStorage: [],
	TiDBGraphStorage: ['TIDB_USER', 'TIDB_PASSWORD', 'TIDB_DATABASE'],
	AGEStorage: ['AGE_POSTGRES_DB', 'AGE_POSTGRES_USER', 'AGE_POSTGRES_PASSWORD'],
	GremlinStorage: ['GREMLIN_HOST', 'GREMLIN_PORT', 'GREMLIN_GRAPH'],
	PGGraphStorage: ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DATABASE'],
	OracleGraphStorage: [
		'ORACLE_DSN',
		'ORACLE_USER',
		'ORACLE_PASSWORD',
		'ORACLE_CONFIG_DIR',
	],
	// Vector Storage Implementations
	NanoVectorDBStorage: [],
	MilvusVectorDBStorage: [],
	ChromaVectorDBStorage: [],
	TiDBVectorDBStorage: ['TIDB_USER', 'TIDB_PASSWORD', 'TIDB_DATABASE'],
	PGVectorStorage: ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DATABASE'],
	FaissVectorDBStorage: [],
	QdrantVectorDBStorage: ['QDRANT_URL'], // QDRANT_API_KEY has default value None
	OracleVectorDBStorage: [
		'ORACLE_DSN',
		'ORACLE_USER',
		'ORACLE_PASSWORD',
		'ORACLE_CONFIG_DIR',
	],
	MongoVectorDBStorage: [],
	// Document Status Storage Implementations
	JsonDocStatusStorage: [],
	PGDocStatusStorage: ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DATABASE'],
	MongoDocStatusStorage: [],
};

/**
 * Storage implementation module mapping
 */
export const STORAGES: Record<string, string> = {
	NetworkXStorage: './networkx_impl',
	JsonKVStorage: './json_kv_impl',
	NanoVectorDBStorage: './nano_vector_db_impl',
	JsonDocStatusStorage: './json_doc_status_impl',
	Neo4JStorage: './neo4j_impl',
	OracleKVStorage: './oracle_impl',
	OracleGraphStorage: './oracle_impl',
	OracleVectorDBStorage: './oracle_impl',
	MilvusVectorDBStorage: './milvus_impl',
	MongoKVStorage: 'mongo_impl',
	MongoDocStatusStorage: 'mongo_impl',
	MongoGraphStorage: 'mongo_impl',
	MongoVectorDBStorage: 'mongo_impl',
	RedisKVStorage: './redis_impl',
	ChromaVectorDBStorage: './chroma_impl',
	TiDBKVStorage: './tidb_impl',
	TiDBVectorDBStorage: './tidb_impl',
	TiDBGraphStorage: './tidb_impl',
	PGKVStorage: './postgres_impl',
	PGVectorStorage: './postgres_impl',
	AGEStorage: './age_impl',
	PGGraphStorage: './postgres_impl',
	GremlinStorage: './gremlin_impl',
	PGDocStatusStorage: './postgres_impl',
	FaissVectorDBStorage: './faiss_impl',
	QdrantVectorDBStorage: './qdrant_impl',
};

/**
 * Verify if storage implementation is compatible with specified storage type
 *
 * @param storageType Storage type (KV_STORAGE, GRAPH_STORAGE etc.)
 * @param storageName Storage implementation name
 * @throws Error if storage implementation is incompatible or missing required methods
 */
export function verifyStorageImplementation(
	storageType: string,
	storageName: string,
): void {
	if (!(storageType in STORAGE_IMPLEMENTATIONS)) {
		throw new Error(`Unknown storage type: ${storageType}`);
	}

	const storageInfo = STORAGE_IMPLEMENTATIONS[storageType];
	if (!storageInfo.implementations.includes(storageName)) {
		throw new Error(
			`Storage implementation '${storageName}' is not compatible with ${storageType}. ` +
				`Compatible implementations are: ${storageInfo.implementations.join(', ')}`,
		);
	}
}

/**
 * Load a storage implementation dynamically
 *
 * @param storageName Storage implementation name
 * @returns Storage implementation class
 */
export async function loadStorageImplementation(storageName: string): Promise<any> {
	if (!(storageName in STORAGES)) {
		throw new Error(`Unknown storage implementation: ${storageName}`);
	}

	const modulePath = STORAGES[storageName];
	try {
		// In TypeScript/JavaScript, imports are static, so we have to use require
		// to dynamically load modules. For production code, you might need to use
		// a bundler-specific approach or include all potential implementations.
		const module = await import(modulePath);

		// Assume the class name is the same as storageName
		if (!(storageName in module)) {
			throw new Error(
				`Class ${storageName} not found in module ${modulePath}`,
			);
		}

		return module[storageName];
	} catch (error) {
		throw new Error(
			`Failed to load storage implementation '${storageName}': ${error}`,
		);
	}
}

// Export all storage implementations
// export * from './json_kv_impl';
// export * from './nano_vector_db_impl';
// export * from './networkx_impl';
// export * from './json_doc_status_impl';

// Export other implementations as needed
// The imports below should be uncommented as implementations are added
/*
  export * from './neo4j_impl';
  export * from './oracle_impl';
  export * from './milvus_impl';
  export * from './mongo_impl';
  export * from './redis_impl';
  export * from './chroma_impl';
  export * from './tidb_impl';
  export * from './postgres_impl';
  export * from './age_impl';
  export * from './gremlin_impl';
  export * from './faiss_impl';
  export * from './qdrant_impl';
  */
