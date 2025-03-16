// types.ts
import { Collection, Db } from 'mongodb';

export interface GlobalConfig {
	embedding_batch_num: number;
	vector_db_storage_cls_kwargs?: {
		cosine_better_than_threshold?: number;
	};
	[key: string]: any;
}

export interface EmbeddingFunction {
	(texts: string[]): Promise<number[][]>;
	embedding_dim: number;
}

export interface KnowledgeGraphNode {
	id: string;
	labels: string[];
	properties: Record<string, any>;
}

export interface KnowledgeGraphEdge {
	id: string;
	type: string;
	source: string;
	target: string;
	properties: Record<string, any>;
}

export interface KnowledgeGraph {
	nodes: KnowledgeGraphNode[];
	edges: KnowledgeGraphEdge[];
}

export enum DocStatus {
	PENDING = 'pending',
	PROCESSING = 'processing',
	PROCESSED = 'processed',
	FAILED = 'failed',
	DELETED = 'deleted',
}

export interface DocProcessingStatus {
	content: string;
	content_summary?: string;
	content_length: number;
	status: string;
	created_at?: Date;
	updated_at?: Date;
	chunks_count: number;
}

export interface StorageBase {
	namespace: string;
	global_config: GlobalConfig;
	initialize(): Promise<void>;
	finalize(): Promise<void>;
	indexDoneCallback(): Promise<void>;
}

export interface KVStorage extends StorageBase {
	get_by_id(id: string): Promise<Record<string, any> | null>;
	get_by_ids(ids: string[]): Promise<Record<string, any>[]>;
	filter_keys(keys: Set<string>): Promise<Set<string>>;
	upsert(data: Record<string, Record<string, any>>): Promise<void>;
	get_by_mode_and_id(
		mode: string,
		id: string,
	): Promise<Record<string, any> | null>;
}

export interface DocStatusStorage extends StorageBase {
	get_by_id(id: string): Promise<Record<string, any> | null>;
	get_by_ids(ids: string[]): Promise<Record<string, any>[]>;
	filter_keys(keys: Set<string>): Promise<Set<string>>;
	upsert(data: Record<string, Record<string, any>>): Promise<void>;
	get_status_counts(): Promise<Record<string, number>>;
	get_docs_by_status(
		status: DocStatus,
	): Promise<Record<string, DocProcessingStatus>>;
}

export interface GraphStorage extends StorageBase {
	embedding_func: EmbeddingFunction;
	has_node(nodeId: string): Promise<boolean>;
	has_edge(sourceNodeId: string, targetNodeId: string): Promise<boolean>;
	node_degree(nodeId: string): Promise<number>;
	edge_degree(srcId: string, tgtId: string): Promise<number>;
	get_node(nodeId: string): Promise<Record<string, string> | null>;
	get_edge(
		sourceNodeId: string,
		targetNodeId: string,
	): Promise<Record<string, string> | null>;
	get_node_edges(sourceNodeId: string): Promise<[string, string][] | null>;
	upsert_node(nodeId: string, nodeData: Record<string, string>): Promise<void>;
	upsert_edge(
		sourceNodeId: string,
		targetNodeId: string,
		edgeData: Record<string, string>,
	): Promise<void>;
	delete_node(nodeId: string): Promise<void>;
	get_all_labels(): Promise<string[]>;
	get_knowledge_graph(
		nodeLabel: string,
		maxDepth?: number,
	): Promise<KnowledgeGraph>;
	remove_nodes(nodes: string[]): Promise<void>;
	remove_edges(edges: [string, string][]): Promise<void>;
}

export interface VectorStorage extends StorageBase {
	embedding_func: EmbeddingFunction;
	meta_fields: string[];
	upsert(data: Record<string, Record<string, any>>): Promise<any>;
	query(
		query: string,
		topK: number,
		ids?: string[] | null,
	): Promise<Record<string, any>[]>;
	delete(ids: string[]): Promise<void>;
	delete_entity(entityName: string): Promise<void>;
	delete_entity_relation(entityName: string): Promise<void>;
	search_by_prefix(prefix: string): Promise<Record<string, any>[]>;
	get_by_id(id: string): Promise<Record<string, any> | null>;
	get_by_ids(ids: string[]): Promise<Record<string, any>[]>;
}

export interface MongoDBCollection extends Collection<any> {
	list_search_indexes?: () => any;
	create_search_index?: (model: any) => Promise<any>;
}
