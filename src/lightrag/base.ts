import dotenv from 'dotenv';
import { KnowledgeGraph } from './types';

// Load environment variables
dotenv.config();

// Helper to get environment variables with defaults
const getEnvInt = (key: string, defaultValue: string): number => {
	return parseInt(process.env[key] || defaultValue, 10);
};

/**
 * Schema for text chunks
 */
export interface TextChunkSchema {
	tokens: number;
	content: string;
	full_doc_id: string;
	chunk_order_index: number;
}

/**
 * Configuration parameters for query execution in LightRAG
 */
export class QueryParam {
	/**
	 * Specifies the retrieval mode:
	 * - "local": Focuses on context-dependent information.
	 * - "global": Utilizes global knowledge.
	 * - "hybrid": Combines local and global retrieval methods.
	 * - "naive": Performs a basic search without advanced techniques.
	 * - "mix": Integrates knowledge graph and vector retrieval.
	 */
	mode: 'local' | 'global' | 'hybrid' | 'naive' | 'mix' = 'global';

	/**
	 * If true, only returns the retrieved context without generating a response.
	 */
	only_need_context: boolean = false;

	/**
	 * If true, only returns the generated prompt without producing a response.
	 */
	only_need_prompt: boolean = false;

	/**
	 * Defines the response format. Examples: 'Multiple Paragraphs', 'Single Paragraph', 'Bullet Points'.
	 */
	response_type: string = 'Multiple Paragraphs';

	/**
	 * If true, enables streaming output for real-time responses.
	 */
	stream: boolean = false;

	/**
	 * Number of top items to retrieve. Represents entities in 'local' mode and relationships in 'global' mode.
	 */
	top_k: number = getEnvInt('TOP_K', '60');

	/**
	 * Maximum number of tokens allowed for each retrieved text chunk.
	 */
	max_token_for_text_unit: number = getEnvInt('MAX_TOKEN_TEXT_CHUNK', '4000');

	/**
	 * Maximum number of tokens allocated for relationship descriptions in global retrieval.
	 */
	max_token_for_global_context: number = getEnvInt(
		'MAX_TOKEN_RELATION_DESC',
		'4000',
	);

	/**
	 * Maximum number of tokens allocated for entity descriptions in local retrieval.
	 */
	max_token_for_local_context: number = getEnvInt('MAX_TOKEN_ENTITY_DESC', '4000');

	/**
	 * List of high-level keywords to prioritize in retrieval.
	 */
	hl_keywords: string[] = [];

	/**
	 * List of low-level keywords to refine retrieval focus.
	 */
	ll_keywords: string[] = [];

	/**
	 * Stores past conversation history to maintain context.
	 * Format: [{"role": "user/assistant", "content": "message"}].
	 */
	conversation_history: Array<Record<string, string>> = [];

	/**
	 * Number of complete conversation turns (user-assistant pairs) to consider in the response context.
	 */
	history_turns: number = 3;

	/**
	 * List of ids to filter the results.
	 */
	ids: string[] | null = null;

	constructor(params: Partial<QueryParam> = {}) {
		Object.assign(this, params);
	}
}

/**
 * EmbeddingFunc interface - TypeScript equivalent of Python's EmbeddingFunc
 */
export interface EmbeddingFunc {
	embedding_dim: number;
	max_token_size: number;
	func: (texts: string[]) => Promise<number[][]>;
}

/**
 * Abstract base class for storage namespaces
 */
export abstract class StorageNameSpace {
	namespace: string;
	global_config: Record<string, any>;

	constructor(namespace: string, global_config: Record<string, any>) {
		this.namespace = namespace;
		this.global_config = global_config;
	}

	/**
	 * Initialize the storage
	 */
	async initialize(): Promise<void> {
		// Default implementation does nothing
	}

	/**
	 * Finalize the storage
	 */
	async finalize(): Promise<void> {
		// Default implementation does nothing
	}

	/**
	 * Commit the storage operations after indexing
	 */
	abstract indexDoneCallback(): Promise<void>;
}

/**
 * Abstract base class for vector storage
 */
export abstract class BaseVectorStorage extends StorageNameSpace {
	embedding_func: EmbeddingFunc;
	cosine_better_than_threshold: number;
	meta_fields: Set<string>;

	constructor(
		namespace: string,
		global_config: Record<string, any>,
		embedding_func: EmbeddingFunc,
		cosine_better_than_threshold: number = 0.2,
		meta_fields: Set<string> = new Set(),
	) {
		super(namespace, global_config);
		this.embedding_func = embedding_func;
		this.cosine_better_than_threshold = cosine_better_than_threshold;
		this.meta_fields = meta_fields;
	}

	/**
	 * Query the vector storage and retrieve top_k results.
	 */
	abstract query(
		query: string,
		top_k: number,
		ids?: string[] | null,
	): Promise<Array<Record<string, any>>>;

	/**
	 * Insert or update vectors in the storage.
	 */
	abstract upsert(data: Record<string, Record<string, any>>): Promise<void>;

	/**
	 * Delete a single entity by its name.
	 */
	abstract deleteEntity(entity_name: string): Promise<void>;

	/**
	 * Delete relations for a given entity.
	 */
	abstract deleteEntityRelation(entity_name: string): Promise<void>;

	/**
	 * Get vector data by its ID
	 */
	abstract getById(id: string): Promise<Record<string, any> | null>;

	/**
	 * Get multiple vector data by their IDs
	 */
	abstract getByIds(ids: string[]): Promise<Array<Record<string, any>>>;
}

/**
 * Abstract base class for key-value storage
 */
export abstract class BaseKVStorage extends StorageNameSpace {
	embedding_func: EmbeddingFunc;

	constructor(
		namespace: string,
		global_config: Record<string, any>,
		embedding_func: EmbeddingFunc,
	) {
		super(namespace, global_config);
		this.embedding_func = embedding_func;
	}

	/**
	 * Get value by id
	 */
	abstract getById(id: string): Promise<Record<string, any> | null>;

	/**
	 * Get values by ids
	 */
	abstract getByIds(ids: string[]): Promise<Array<Record<string, any>>>;

	/**
	 * Return un-exist keys
	 */
	abstract filterKeys(keys: Set<string>): Promise<Set<string>>;

	/**
	 * Upsert data
	 */
	abstract upsert(data: Record<string, Record<string, any>>): Promise<void>;
}

/**
 * Abstract base class for graph storage
 */
export abstract class BaseGraphStorage extends StorageNameSpace {
	embedding_func: EmbeddingFunc;

	constructor(
		namespace: string,
		global_config: Record<string, any>,
		embedding_func: EmbeddingFunc,
	) {
		super(namespace, global_config);
		this.embedding_func = embedding_func;
	}

	/**
	 * Check if a node exists in the graph.
	 */
	abstract hasNode(node_id: string): Promise<boolean>;

	/**
	 * Check if an edge exists in the graph.
	 */
	abstract hasEdge(
		source_node_id: string,
		target_node_id: string,
	): Promise<boolean>;

	/**
	 * Get the degree of a node.
	 */
	abstract nodeDegree(node_id: string): Promise<number>;

	/**
	 * Get the degree of an edge.
	 */
	abstract edgeDegree(src_id: string, tgt_id: string): Promise<number>;

	/**
	 * Get a node by its id.
	 */
	abstract getNode(node_id: string): Promise<Record<string, string> | null>;

	/**
	 * Get an edge by its source and target node ids.
	 */
	abstract getEdge(
		source_node_id: string,
		target_node_id: string,
	): Promise<Record<string, string> | null>;

	/**
	 * Get all edges connected to a node.
	 */
	abstract getNodeEdges(
		source_node_id: string,
	): Promise<Array<[string, string]> | null>;

	/**
	 * Upsert a node into the graph.
	 */
	abstract upsertNode(
		node_id: string,
		node_data: Record<string, string>,
	): Promise<void>;

	/**
	 * Upsert an edge into the graph.
	 */
	abstract upsertEdge(
		source_node_id: string,
		target_node_id: string,
		edge_data: Record<string, string>,
	): Promise<void>;

	/**
	 * Delete a node from the graph.
	 */
	abstract deleteNode(node_id: string): Promise<void>;

	/**
	 * Embed nodes using an algorithm.
	 */
	abstract embedNodes(algorithm: string): Promise<[number[][], string[]]>;

	/**
	 * Get all labels in the graph.
	 */
	abstract getAllLabels(): Promise<string[]>;

	/**
	 * Get a knowledge graph of a node.
	 */
	abstract getKnowledgeGraph(
		node_label: string,
		max_depth?: number,
	): Promise<KnowledgeGraph>;
}

/**
 * Document processing status enum
 */
export enum DocStatus {
	PENDING = 'pending',
	PROCESSING = 'processing',
	PROCESSED = 'processed',
	FAILED = 'failed',
}

/**
 * Document processing status data structure
 */
export class DocProcessingStatus {
	/**
	 * Original content of the document
	 */
	content: string;

	/**
	 * First 100 chars of document content, used for preview
	 */
	content_summary: string;

	/**
	 * Total length of document
	 */
	content_length: number;

	/**
	 * Current processing status
	 */
	status: DocStatus;

	/**
	 * ISO format timestamp when document was created
	 */
	created_at: string;

	/**
	 * ISO format timestamp when document was last updated
	 */
	updated_at: string;

	/**
	 * Number of chunks after splitting, used for processing
	 */
	chunks_count: number | null = null;

	/**
	 * Error message if failed
	 */
	error: string | null = null;

	/**
	 * Additional metadata
	 */
	metadata: Record<string, any> = {};

	constructor(
		content: string,
		content_summary: string,
		content_length: number,
		status: DocStatus,
		created_at: string,
		updated_at: string,
		chunks_count: number | null = null,
		error: string | null = null,
		metadata: Record<string, any> = {},
	) {
		this.content = content;
		this.content_summary = content_summary;
		this.content_length = content_length;
		this.status = status;
		this.created_at = created_at;
		this.updated_at = updated_at;
		this.chunks_count = chunks_count;
		this.error = error;
		this.metadata = metadata;
	}
}

/**
 * Abstract base class for document status storage
 */
export abstract class DocStatusStorage extends BaseKVStorage {
	/**
	 * Get counts of documents in each status
	 */
	abstract getStatusCounts(): Promise<Record<string, number>>;

	/**
	 * Get all documents with a specific status
	 */
	abstract getDocsByStatus(
		status: DocStatus,
	): Promise<Record<string, DocProcessingStatus>>;
}

/**
 * Storages status enum
 */
export enum StoragesStatus {
	NOT_CREATED = 'not_created',
	CREATED = 'created',
	INITIALIZED = 'initialized',
	FINALIZED = 'finalized',
}
