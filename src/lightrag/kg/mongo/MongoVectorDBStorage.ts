// MongoVectorDBStorage.ts
import { Db } from 'mongodb';
import { EmbeddingFunction, MongoDBCollection } from './types';
import { ClientManager } from './MongoClient';
import { getOrCreateCollection } from './utils';
import { computeMdHashId } from '../../utils';
import { LightRAGConfig } from '../../lightrag';

/**
 * MongoDB implementation of Vector Storage using Atlas Vector Search
 */
export class MongoVectorDBStorage {
	public namespace: string;
	public global_config: LightRAGConfig;
	public embedding_func: EmbeddingFunction;
	public meta_fields: string[];
	private db: Db | null = null;
	private _data: MongoDBCollection | null = null;
	private _collectionName: string;
	private cosine_better_than_threshold: number;
	private _max_batch_size: number;

	/**
	 * Creates a new MongoVectorDBStorage instance
	 * @param namespace Storage namespace
	 * @param lightRAGConfig Global configuration
	 * @param embeddingFunc Function to compute embeddings
	 * @param metaFields Fields to include in storage besides vector
	 */
	constructor(
		namespace: string,
		lightRAGConfig: LightRAGConfig,
		embeddingFunc: EmbeddingFunction,
		metaFields: string[] = [],
	) {
		this.namespace = namespace;
		this.global_config = lightRAGConfig;
		this.embedding_func = embeddingFunc;
		this.meta_fields = metaFields;
		this._collectionName = namespace;

		const kwargs = this.global_config.vectorDbStorageClsKwargs || {};
		const cosineThreshold = kwargs.cosineBetterThanThreshold;

		if (cosineThreshold === undefined) {
			throw new Error(
				'cosine_better_than_threshold must be specified in vectorDbStorageClsKwargs',
			);
		}

		this.cosine_better_than_threshold = cosineThreshold;
		this._max_batch_size = this.global_config.embeddingBatchNum;
	}

	/**
	 * Initialize the storage
	 */
	public async initialize(): Promise<void> {
		if (this.db === null) {
			this.db = await ClientManager.getClient();
			this._data = await getOrCreateCollection(this.db, this._collectionName);

			// Ensure vector index exists
			await this.createVectorIndexIfNotExists();

			console.debug(`Use MongoDB as VDB ${this._collectionName}`);
		}
	}

	/**
	 * Finalize and clean up resources
	 */
	public async finalize(): Promise<void> {
		if (this.db !== null) {
			await ClientManager.releaseClient(this.db);
			this.db = null;
			this._data = null;
		}
	}

	/**
	 * Create a vector search index if it doesn't exist
	 */
	private async createVectorIndexIfNotExists(): Promise<void> {
		if (!this._data) throw new Error('Storage not initialized');

		try {
			const indexName = 'vector_knn_index';

			// Check if index already exists
			if (this._data.list_search_indexes) {
				const indexes = await this._data.list_search_indexes().toArray();
				for (const index of indexes) {
					if (index.name === indexName) {
						console.debug('Vector index already exists');
						return;
					}
				}
			} else {
				console.warn(
					'List search indexes not available, skipping index creation check',
				);
				return;
			}

			// Create search index
			if (this._data.create_search_index) {
				const searchIndexModel = {
					definition: {
						fields: [
							{
								type: 'vector',
								numDimensions: this.embedding_func.embedding_dim,
								path: 'vector',
								similarity: 'cosine',
							},
						],
					},
					name: indexName,
					type: 'vectorSearch',
				};

				await this._data.create_search_index(searchIndexModel);
				console.log('Vector index created successfully');
			} else {
				console.warn(
					'Create search index not available, skipping index creation',
				);
			}
		} catch (e) {
			console.debug('Vector index already exists or error creating index');
		}
	}

	/**
	 * Insert or update vector data
	 * @param data Dictionary of documents to upsert, keyed by ID
	 * @returns Array of inserted documents
	 */
	public async upsert(data: Record<string, Record<string, any>>): Promise<any> {
		if (!this._data) throw new Error('Storage not initialized');
		console.log(`Inserting ${Object.keys(data).length} to ${this.namespace}`);

		if (Object.keys(data).length === 0) {
			return;
		}

		// Prepare data
		const listData = Object.entries(data).map(([k, v]) => ({
			_id: k,
			...Object.fromEntries(
				Object.entries(v).filter(([k1]) =>
					(this.meta_fields ?? []).includes(k1),
				),
			),
		}));

		const contents = Object.values(data).map((v) => v.content);

		// Split into batches for embedding
		const batches: string[][] = [];
		for (let i = 0; i < contents.length; i += this._max_batch_size) {
			batches.push(contents.slice(i, i + this._max_batch_size));
		}

		// Generate embeddings
		const embeddingTasks = batches.map((batch) => this.embedding_func(batch));
		const embeddingsList = await Promise.all(embeddingTasks);

		// Flatten embeddings
		const embeddings: number[][] = [];
		for (const batch of embeddingsList) {
			embeddings.push(...batch);
		}

		// Add embeddings to documents
		for (let i = 0; i < listData.length; i++) {
			(listData[i] as any).vector = embeddings[i];
		}

		// Upsert documents
		const updatePromises = listData.map((doc) =>
			this._data!.updateOne({ _id: doc._id }, { $set: doc }, { upsert: true }),
		);

		await Promise.all(updatePromises);
		return listData;
	}

	/**
	 * Query for similar vectors
	 * @param query Query text
	 * @param topK Number of results to return
	 * @param ids Optional IDs to filter results
	 * @returns Array of matching documents
	 */
	public async query(
		query: string,
		topK: number,
		ids: string[] | null = null,
	): Promise<Record<string, any>[]> {
		if (!this._data) throw new Error('Storage not initialized');

		// Generate query embedding
		const embedding = await this.embedding_func([query]);
		const queryVector = embedding[0];

		// Build aggregation pipeline
		const pipeline: any[] = [
			{
				$vectorSearch: {
					index: 'default',
					path: 'vector',
					queryVector: queryVector,
					numCandidates: 100,
					limit: topK,
				},
			},
			{ $addFields: { score: { $meta: 'vectorSearchScore' } } },
			{ $match: { score: { $gte: this.cosine_better_than_threshold } } },
			{ $project: { vector: 0 } },
		];

		// Execute query
		const cursor = this._data.aggregate(pipeline);
		const results = await cursor.toArray();

		// Format results
		return results.map((doc) => ({
			...doc,
			id: doc._id,
			distance: doc.score,
		}));
	}

	/**
	 * Delete vectors by ID
	 * @param ids Array of vector IDs to delete
	 */
	public async delete(ids: string[]): Promise<void> {
		if (!this._data) throw new Error('Storage not initialized');

		console.log(`Deleting ${ids.length} vectors from ${this.namespace}`);
		if (!ids.length) return;

		try {
			const result = await this._data.deleteMany({ _id: { $in: ids } });
			console.debug(
				`Successfully deleted ${result.deletedCount} vectors from ${this.namespace}`,
			);
		} catch (e) {
			console.error(
				`Error while deleting vectors from ${this.namespace}: ${String(e)}`,
			);
		}
	}

	/**
	 * Delete an entity by name
	 * @param entityName Entity name
	 */
	public async delete_entity(entityName: string): Promise<void> {
		if (!this._data) throw new Error('Storage not initialized');

		try {
			const entityId = computeMdHashId(entityName, 'ent-');
			console.debug(
				`Attempting to delete entity ${entityName} with ID ${entityId}`,
			);

			const result = await this._data.deleteOne({ _id: entityId });

			if (result.deletedCount > 0) {
				console.debug(`Successfully deleted entity ${entityName}`);
			} else {
				console.debug(`Entity ${entityName} not found in storage`);
			}
		} catch (e) {
			console.error(`Error deleting entity ${entityName}: ${String(e)}`);
		}
	}

	/**
	 * Delete all relations for an entity
	 * @param entityName Entity name
	 */
	public async delete_entity_relation(entityName: string): Promise<void> {
		if (!this._data) throw new Error('Storage not initialized');

		try {
			// Find relations where entity appears as source or target
			const relationsCursor = this._data.find({
				$or: [{ src_id: entityName }, { tgt_id: entityName }],
			});

			const relations = await relationsCursor.toArray();

			if (!relations.length) {
				console.debug(`No relations found for entity ${entityName}`);
				return;
			}

			// Extract IDs of relations to delete
			const relationIds = relations.map((relation) => relation._id);
			console.debug(
				`Found ${relationIds.length} relations for entity ${entityName}`,
			);

			// Delete the relations
			const result = await this._data.deleteMany({
				_id: { $in: relationIds },
			});
			console.debug(
				`Deleted ${result.deletedCount} relations for ${entityName}`,
			);
		} catch (e) {
			console.error(
				`Error deleting relations for ${entityName}: ${String(e)}`,
			);
		}
	}

	/**
	 * Search for records with IDs matching a prefix
	 * @param prefix Prefix to search for
	 * @returns Array of matching records
	 */
	public async search_by_prefix(prefix: string): Promise<Record<string, any>[]> {
		if (!this._data) throw new Error('Storage not initialized');

		try {
			// Use MongoDB regex to find documents where _id starts with the prefix
			const cursor = this._data.find({ _id: { $regex: `^${prefix}` } });
			const matchingRecords = await cursor.toArray();

			// Format results
			const results = matchingRecords.map((doc) => ({
				...doc,
				id: doc._id,
			}));

			console.debug(
				`Found ${results.length} records with prefix '${prefix}' in ${this.namespace}`,
			);
			return results;
		} catch (e) {
			console.error(
				`Error searching by prefix in ${this.namespace}: ${String(e)}`,
			);
			return [];
		}
	}

	/**
	 * Get a vector by ID
	 * @param id Vector ID
	 * @returns Vector data or null if not found
	 */
	public async get_by_id(id: string): Promise<Record<string, any> | null> {
		if (!this._data) throw new Error('Storage not initialized');

		try {
			// Search for the specific ID in MongoDB
			const result = await this._data.findOne({ _id: id });

			if (result) {
				// Format the result to include id field expected by API
				const resultDict = { ...result };

				if ('_id' in resultDict && !('id' in resultDict)) {
					resultDict.id = resultDict._id;
				}

				return resultDict;
			}

			return null;
		} catch (e) {
			console.error(`Error retrieving vector data for ID ${id}: ${e}`);
			return null;
		}
	}

	/**
	 * Get multiple vectors by IDs
	 * @param ids Array of vector IDs
	 * @returns Array of vector data
	 */
	public async get_by_ids(ids: string[]): Promise<Record<string, any>[]> {
		if (!this._data) throw new Error('Storage not initialized');

		if (!ids.length) {
			return [];
		}

		try {
			// Query MongoDB for multiple IDs
			const cursor = this._data.find({ _id: { $in: ids } });
			const results = await cursor.toArray();

			// Format results to include id field expected by API
			return results.map((result) => {
				const resultDict = { ...result };

				if ('_id' in resultDict && !('id' in resultDict)) {
					resultDict.id = resultDict._id;
				}

				return resultDict;
			});
		} catch (e) {
			console.error(`Error retrieving vector data for IDs ${ids}: ${e}`);
			return [];
		}
	}

	/**
	 * Called when indexing is complete
	 */
	public async indexDoneCallback(): Promise<void> {
		// MongoDB handles persistence automatically, so nothing to do here
	}
}
