/**
 * Type definitions for LightRAG
 */

/**
 * Interface for keyword extraction format
 * Equivalent to GPTKeywordExtractionFormat in Python
 */
export interface GPTKeywordExtractionFormat {
	high_level_keywords: string[];
	low_level_keywords: string[];
}

/**
 * Interface for knowledge graph node
 * Equivalent to KnowledgeGraphNode in Python
 */
export interface KnowledgeGraphNode {
	id: string;
	labels: string[];
	properties: Record<string, any>; // any properties
}

/**
 * Interface for knowledge graph edge
 * Equivalent to KnowledgeGraphEdge in Python
 */
export interface KnowledgeGraphEdge {
	id: string;
	type?: string; // Optional in TypeScript
	source: string; // id of source node
	target: string; // id of target node
	properties: Record<string, any>; // any properties
}

/**
 * Interface for knowledge graph
 * Equivalent to KnowledgeGraph in Python
 */
export interface KnowledgeGraph {
	nodes: KnowledgeGraphNode[];
	edges: KnowledgeGraphEdge[];
}
