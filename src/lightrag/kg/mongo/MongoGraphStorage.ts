// MongoGraphStorage.ts
import { Db, Collection } from 'mongodb';
import { EmbeddingFunction, KnowledgeGraph } from './types';
import { ClientManager } from './MongoClient';
import { getOrCreateCollection } from './utils';
import { LightRAGConfig } from '../../lightrag';

/**
 * MongoDB implementation of Graph Storage
 */
export class MongoGraphStorage {
	public namespace: string;
	public global_config: LightRAGConfig;
	public embedding_func: EmbeddingFunction;
	private db: Db | null = null;
	private collection: Collection<any> | null = null;
	private _collectionName: string;

	/**
	 * Creates a new MongoGraphStorage instance
	 * @param namespace Storage namespace
	 * @param globalConfig Global configuration
	 * @param embeddingFunc Function to compute embeddings
	 */
	constructor(
		namespace: string,
		globalConfig: LightRAGConfig,
		embeddingFunc: EmbeddingFunction,
	) {
		this.namespace = namespace;
		this.global_config = globalConfig;
		this.embedding_func = embeddingFunc;
		this._collectionName = namespace;
	}

	/**
	 * Initialize the storage
	 */
	public async initialize(): Promise<void> {
		if (this.db === null) {
			this.db = await ClientManager.getClient();
			this.collection = await getOrCreateCollection(
				this.db,
				this._collectionName,
			);
			console.debug(`Use MongoDB as KG ${this._collectionName}`);
		}
	}

	/**
	 * Finalize and clean up resources
	 */
	public async finalize(): Promise<void> {
		if (this.db !== null) {
			await ClientManager.releaseClient(this.db);
			this.db = null;
			this.collection = null;
		}
	}

	/**
	 * Helper for graph lookup operations
	 * @param startNodeId Starting node ID
	 * @param maxDepth Maximum traversal depth
	 * @returns Results of the graph lookup
	 */
	private async _graph_lookup(
		startNodeId: string,
		maxDepth?: number,
	): Promise<any[]> {
		if (!this.collection) throw new Error('Storage not initialized');

		const pipeline: any[] = [
			{ $match: { _id: startNodeId } },
			{
				$graphLookup: {
					from: this.collection.collectionName,
					startWith: '$edges.target',
					connectFromField: 'edges.target',
					connectToField: '_id',
					as: 'reachableNodes',
					depthField: 'depth',
				},
			},
		];

		if (maxDepth !== undefined) {
			pipeline[1].$graphLookup.maxDepth = maxDepth;
		}

		const cursor = this.collection.aggregate(pipeline);
		return await cursor.toArray();
	}

	/**
	 * Check if a node exists
	 * @param nodeId Node ID to check
	 * @returns Whether the node exists
	 */
	public async hasNode(nodeId: string): Promise<boolean> {
		if (!this.collection) throw new Error('Storage not initialized');
		const doc = await this.collection.findOne(
			{ _id: nodeId },
			{ projection: { _id: 1 } },
		);
		return doc !== null;
	}

	/**
	 * Check if an edge exists between two nodes
	 * @param sourceNodeId Source node ID
	 * @param targetNodeId Target node ID
	 * @returns Whether the edge exists
	 */
	public async hasEdge(
		sourceNodeId: string,
		targetNodeId: string,
	): Promise<boolean> {
		if (!this.collection) throw new Error('Storage not initialized');

		const pipeline = [
			{ $match: { _id: sourceNodeId } },
			{
				$graphLookup: {
					from: this.collection.collectionName,
					startWith: '$edges.target',
					connectFromField: 'edges.target',
					connectToField: '_id',
					as: 'reachableNodes',
					depthField: 'depth',
					maxDepth: 0,
				},
			},
			{
				$project: {
					_id: 0,
					'reachableNodes._id': 1,
				},
			},
		];

		const cursor = this.collection.aggregate(pipeline);
		const results = await cursor.toArray();

		if (!results.length) return false;

		const reachableIds = results[0].reachableNodes.map((node: any) => node._id);
		return reachableIds.includes(targetNodeId);
	}

	/**
	 * Get the degree (number of connected edges) of a node
	 * @param nodeId Node ID
	 * @returns Degree of the node
	 */
	public async nodeDegree(nodeId: string): Promise<number> {
		if (!this.collection) throw new Error('Storage not initialized');

		// Get outbound edges from the node document
		const doc = await this.collection.findOne(
			{ _id: nodeId },
			{ projection: { edges: 1 } },
		);
		if (!doc) return 0;

		const outboundCount = doc.edges?.length || 0;

		// Get inbound edges using aggregation
		const inboundCountPipeline = [
			{ $match: { 'edges.target': nodeId } },
			{
				$project: {
					matchingEdgesCount: {
						$size: {
							$filter: {
								input: '$edges',
								as: 'edge',
								cond: { $eq: ['$edge.target', nodeId] },
							},
						},
					},
				},
			},
			{ $group: { _id: null, totalInbound: { $sum: '$matchingEdgesCount' } } },
		];

		const inboundCursor = this.collection.aggregate(inboundCountPipeline);
		const inboundResult = await inboundCursor.toArray();
		const inboundCount = inboundResult.length
			? inboundResult[0].totalInbound
			: 0;

		return outboundCount + inboundCount;
	}

	/**
	 * Get the number of edges between two nodes
	 * @param srcId Source node ID
	 * @param tgtId Target node ID
	 * @returns Number of edges
	 */
	public async edgeDegree(srcId: string, tgtId: string): Promise<number> {
		if (!this.collection) throw new Error('Storage not initialized');

		const pipeline = [
			{ $match: { _id: srcId } },
			{
				$graphLookup: {
					from: this.collection.collectionName,
					startWith: '$edges.target',
					connectFromField: 'edges.target',
					connectToField: '_id',
					as: 'neighbors',
					depthField: 'depth',
					maxDepth: 0,
				},
			},
			{ $project: { edges: 1, 'neighbors._id': 1, 'neighbors.type': 1 } },
		];

		const cursor = this.collection.aggregate(pipeline);
		const results = await cursor.toArray();

		if (!results.length) return 0;

		// Count edges with target matching tgtId
		const edges = results[0].edges || [];
		const count = edges.filter((e: any) => e.target === tgtId).length;

		return count;
	}

	/**
	 * Get a node by ID
	 * @param nodeId Node ID
	 * @returns Node or null if not found
	 */
	public async getNode(nodeId: string): Promise<Record<string, string> | null> {
		if (!this.collection) throw new Error('Storage not initialized');
		return await this.collection.findOne({ _id: nodeId });
	}

	/**
	 * Get an edge between two nodes
	 * @param sourceNodeId Source node ID
	 * @param targetNodeId Target node ID
	 * @returns Edge data or null if not found
	 */
	public async getEdge(
		sourceNodeId: string,
		targetNodeId: string,
	): Promise<Record<string, string> | null> {
		if (!this.collection) throw new Error('Storage not initialized');

		const pipeline = [
			{ $match: { _id: sourceNodeId } },
			{
				$graphLookup: {
					from: this.collection.collectionName,
					startWith: '$edges.target',
					connectFromField: 'edges.target',
					connectToField: '_id',
					as: 'neighbors',
					depthField: 'depth',
					maxDepth: 0,
				},
			},
			{ $project: { edges: 1 } },
		];

		const cursor = this.collection.aggregate(pipeline);
		const docs = await cursor.toArray();

		if (!docs.length) return null;

		// Find edge with matching target
		for (const e of docs[0].edges || []) {
			if (e.target === targetNodeId) {
				return e;
			}
		}

		return null;
	}

	/**
	 * Get all edges from a node
	 * @param sourceNodeId Source node ID
	 * @returns Array of [source, target] tuples or null if node not found
	 */
	public async getNodeEdges(
		sourceNodeId: string,
	): Promise<[string, string][] | null> {
		if (!this.collection) throw new Error('Storage not initialized');

		const pipeline = [
			{ $match: { _id: sourceNodeId } },
			{
				$graphLookup: {
					from: this.collection.collectionName,
					startWith: '$edges.target',
					connectFromField: 'edges.target',
					connectToField: '_id',
					as: 'neighbors',
					depthField: 'depth',
					maxDepth: 0,
				},
			},
			{ $project: { _id: 0, edges: 1 } },
		];

		const cursor = this.collection.aggregate(pipeline);
		const result = await cursor.toArray();

		if (!result.length) return null;

		const edges = result[0].edges || [];
		return edges.map((e: any) => [sourceNodeId, e.target] as [string, string]);
	}

	/**
	 * Insert or update a node
	 * @param nodeId Node ID
	 * @param nodeData Node data
	 */
	public async upsertNode(
		nodeId: string,
		nodeData: Record<string, string>,
	): Promise<void> {
		if (!this.collection) throw new Error('Storage not initialized');

		const updateDoc = {
			$set: { ...nodeData },
			$setOnInsert: { edges: [] },
		};

		await this.collection.updateOne({ _id: nodeId }, updateDoc, {
			upsert: true,
		});
	}

	/**
	 * Insert or update an edge
	 * @param sourceNodeId Source node ID
	 * @param targetNodeId Target node ID
	 * @param edgeData Edge data
	 */
	public async upsertEdge(
		sourceNodeId: string,
		targetNodeId: string,
		edgeData: Record<string, string>,
	): Promise<void> {
		if (!this.collection) throw new Error('Storage not initialized');

		// Ensure source node exists
		await this.upsertNode(sourceNodeId, {});

		// Remove existing edge if any
		await this.collection.updateOne(
			{ _id: sourceNodeId },
			{ $pull: { edges: { target: targetNodeId } } as any },
		);

		// Insert new edge
		const newEdge = { target: targetNodeId, ...edgeData };
		await this.collection.updateOne(
			{ _id: sourceNodeId },
			{ $push: { edges: newEdge } as any },
		);
	}

	/**
	 * Delete a node and all references to it
	 * @param nodeId Node ID
	 */
	public async deleteNode(nodeId: string): Promise<void> {
		if (!this.collection) throw new Error('Storage not initialized');

		// Remove inbound edges from all other docs
		await this.collection.updateMany(
			{},
			{ $pull: { edges: { target: nodeId } } as any },
		);

		// Remove the node document
		await this.collection.deleteOne({ _id: nodeId });
	}

	/**
	 * Node embedding not used in LightRAG
	 */
	public async embed_nodes(algorithm: string): Promise<[number[][], string[]]> {
		throw new Error('Node embedding is not used in lightrag.');
	}

	/**
	 * Get all node labels in the database
	 * @returns Array of node IDs, alphabetically sorted
	 */
	public async getAllLabels(): Promise<string[]> {
		if (!this.collection) throw new Error('Storage not initialized');

		const pipeline = [{ $group: { _id: '$_id' } }, { $sort: { _id: 1 } }];

		const cursor = this.collection.aggregate(pipeline);
		const results = await cursor.toArray();

		return results.map((doc) => doc._id);
	}

	/**
	 * Get a knowledge graph starting from a node
	 * @param nodeLabel Starting node label
	 * @param maxDepth Maximum traversal depth
	 * @returns Knowledge graph
	 */
	public async getKnowledgeGraph(
		nodeLabel: string,
		maxDepth: number = 5,
	): Promise<KnowledgeGraph> {
		if (!this.collection) throw new Error('Storage not initialized');

		const result: KnowledgeGraph = {
			nodes: [],
			edges: [],
		};

		const seenNodes = new Set<string>();
		const seenEdges = new Set<string>();

		try {
			if (nodeLabel === '*') {
				// Get all nodes and edges
				const cursor = this.collection.find({});

				await cursor.forEach((nodeDoc: any) => {
					const nodeId = String(nodeDoc._id);

					if (!seenNodes.has(nodeId)) {
						result.nodes.push({
							id: nodeId,
							labels: [nodeDoc._id],
							properties: Object.entries(nodeDoc)
								.filter(([k]) => k !== '_id' && k !== 'edges')
								.reduce((obj, [k, v]) => ({ ...obj, [k]: v }), {}),
						});

						seenNodes.add(nodeId);

						// Process edges
						for (const edge of nodeDoc.edges || []) {
							const edgeId = `${nodeId}-${edge.target}`;

							if (!seenEdges.has(edgeId)) {
								result.edges.push({
									id: edgeId,
									type: edge.relation || '',
									source: nodeId,
									target: edge.target,
									properties: Object.entries(edge)
										.filter(
											([k]) =>
												k !== 'target' && k !== 'relation',
										)
										.reduce(
											(obj, [k, v]) => ({ ...obj, [k]: v }),
											{},
										),
								});

								seenEdges.add(edgeId);
							}
						}
					}
				});
			} else {
				// Verify if starting node exists
				const startNodes = await this.collection
					.find({ _id: nodeLabel })
					.limit(1)
					.toArray();

				if (!startNodes.length) {
					console.warn(
						`Starting node with label ${nodeLabel} does not exist!`,
					);
					return result;
				}

				// Use $graphLookup for traversal
				const pipeline = [
					{ $match: { _id: nodeLabel } },
					{
						$graphLookup: {
							from: this._collectionName,
							startWith: '$edges.target',
							connectFromField: 'edges.target',
							connectToField: '_id',
							maxDepth: maxDepth,
							depthField: 'depth',
							as: 'connected_nodes',
						},
					},
				];

				const cursor = this.collection.aggregate(pipeline);

				await cursor.forEach((doc: any) => {
					// Add the start node
					const nodeId = String(doc._id);

					if (!seenNodes.has(nodeId)) {
						result.nodes.push({
							id: nodeId,
							labels: [doc._id],
							properties: Object.entries(doc)
								.filter(
									([k]) =>
										![
											'_id',
											'edges',
											'connected_nodes',
											'depth',
										].includes(k),
								)
								.reduce((obj, [k, v]) => ({ ...obj, [k]: v }), {}),
						});

						seenNodes.add(nodeId);
					}

					// Add edges from start node
					for (const edge of doc.edges || []) {
						const edgeId = `${nodeId}-${edge.target}`;

						if (!seenEdges.has(edgeId)) {
							result.edges.push({
								id: edgeId,
								type: edge.relation || '',
								source: nodeId,
								target: edge.target,
								properties: Object.entries(edge)
									.filter(
										([k]) => k !== 'target' && k !== 'relation',
									)
									.reduce(
										(obj, [k, v]) => ({ ...obj, [k]: v }),
										{},
									),
							});

							seenEdges.add(edgeId);
						}
					}

					// Add connected nodes and their edges
					for (const connected of doc.connected_nodes || []) {
						const connectedId = String(connected._id);

						if (!seenNodes.has(connectedId)) {
							result.nodes.push({
								id: connectedId,
								labels: [connected._id],
								properties: Object.entries(connected)
									.filter(
										([k]) =>
											!['_id', 'edges', 'depth'].includes(k),
									)
									.reduce(
										(obj, [k, v]) => ({ ...obj, [k]: v }),
										{},
									),
							});

							seenNodes.add(connectedId);

							// Add edges from connected nodes
							for (const edge of connected.edges || []) {
								const edgeId = `${connectedId}-${edge.target}`;

								if (!seenEdges.has(edgeId)) {
									result.edges.push({
										id: edgeId,
										type: edge.relation || '',
										source: connectedId,
										target: edge.target,
										properties: Object.entries(edge)
											.filter(
												([k]) =>
													k !== 'target' &&
													k !== 'relation',
											)
											.reduce(
												(obj, [k, v]) => ({
													...obj,
													[k]: v,
												}),
												{},
											),
									});

									seenEdges.add(edgeId);
								}
							}
						}
					}
				});
			}

			console.log(
				`Subgraph query successful | Node count: ${result.nodes.length} | Edge count: ${result.edges.length}`,
			);
		} catch (e) {
			console.error(`MongoDB query failed: ${String(e)}`);
		}

		return result;
	}

	/**
	 * Called when indexing is complete
	 */
	public async indexDoneCallback(): Promise<void> {
		// MongoDB handles persistence automatically, so nothing to do here
	}

	/**
	 * Delete multiple nodes
	 * @param nodes Array of node IDs to delete
	 */
	public async removeNodes(nodes: string[]): Promise<void> {
		if (!this.collection) throw new Error('Storage not initialized');

		console.log(`Deleting ${nodes.length} nodes`);
		if (!nodes.length) return;

		// Remove all edges referencing these nodes
		await this.collection.updateMany(
			{},
			{ $pull: { edges: { target: { $in: nodes } } } as any },
		);

		// Delete the node documents
		await this.collection.deleteMany({ _id: { $in: nodes } });

		console.debug(`Successfully deleted nodes: ${nodes}`);
	}

	/**
	 * Delete multiple edges
	 * @param edges Array of [source, target] edge tuples to delete
	 */
	public async removeEdges(edges: [string, string][]): Promise<void> {
		if (!this.collection) throw new Error('Storage not initialized');

		console.log(`Deleting ${edges.length} edges`);
		if (!edges.length) return;

		const updatePromises: Promise<any>[] = [];

		for (const [source, target] of edges) {
			updatePromises.push(
				this.collection.updateOne(
					{ _id: source },
					{ $pull: { edges: { target } } as any },
				),
			);
		}

		if (updatePromises.length) {
			await Promise.all(updatePromises);
		}

		console.debug(`Successfully deleted edges: ${edges}`);
	}
}
