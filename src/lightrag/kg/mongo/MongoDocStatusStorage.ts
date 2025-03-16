// MongoDocStatusStorage.ts
import { Db, Collection } from 'mongodb';
import { DocStatus, DocProcessingStatus } from './types';
import { getOrCreateCollection } from './utils';
import { ClientManager } from './MongoClient';
import { LightRAGConfig } from '../../lightrag';

/**
 * MongoDB implementation of Document Status Storage
 */
export class MongoDocStatusStorage {
	public namespace: string;
	public globalConfig: LightRAGConfig;
	private db: Db | null = null;
	private _data: Collection<any> | null = null;
	private _collectionName: string;

	/**
	 * Creates a new MongoDocStatusStorage instance
	 * @param namespace Storage namespace
	 * @param globalConfig Global configuration
	 */
	constructor(namespace: string, globalConfig: LightRAGConfig) {
		this.namespace = namespace;
		this.globalConfig = globalConfig;
		this._collectionName = namespace;
	}

	/**
	 * Initialize the storage
	 */
	public async initialize(): Promise<void> {
		if (this.db === null) {
			this.db = await ClientManager.getClient();
			this._data = await getOrCreateCollection(this.db, this._collectionName);
			console.debug(`Use MongoDB as DocStatus ${this._collectionName}`);
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
	 * Get a document by ID
	 * @param id Document ID
	 * @returns Document or null if not found
	 */
	public async getById(id: string): Promise<Record<string, any> | null> {
		if (!this._data) throw new Error('Storage not initialized');
		return await this._data.findOne({ _id: id });
	}

	/**
	 * Get multiple documents by IDs
	 * @param ids Array of document IDs
	 * @returns Array of found documents
	 */
	public async getByIds(ids: string[]): Promise<Record<string, any>[]> {
		if (!this._data) throw new Error('Storage not initialized');
		const cursor = this._data.find({ _id: { $in: ids } });
		return await cursor.toArray();
	}

	/**
	 * Filter out keys that already exist in storage
	 * @param keys Set of keys to check
	 * @returns Set of keys that don't exist in storage
	 */
	public async filterKeys(keys: Set<string>): Promise<Set<string>> {
		if (!this._data) throw new Error('Storage not initialized');
		const cursor = this._data.find(
			{ _id: { $in: Array.from(keys) } },
			{ projection: { _id: 1 } },
		);
		const existingIds = new Set<string>();

		await cursor.forEach((doc) => {
			existingIds.add(String(doc._id));
		});

		return new Set([...keys].filter((key) => !existingIds.has(key)));
	}

	/**
	 * Insert or update multiple documents
	 * @param data Dictionary of documents to upsert, keyed by ID
	 */
	public async upsert(data: Record<string, Record<string, any>>): Promise<void> {
		if (!this._data) throw new Error('Storage not initialized');
		console.log(`Inserting ${Object.keys(data).length} to ${this.namespace}`);

		if (Object.keys(data).length === 0) {
			return;
		}

		const updatePromises = Object.entries(data).map(([k, v]) => {
			data[k]._id = k;
			return this._data!.updateOne({ _id: k }, { $set: v }, { upsert: true });
		});

		await Promise.all(updatePromises);
	}

	/**
	 * Get counts of documents in each status
	 * @returns Object mapping status to count
	 */
	public async getStatusCounts(): Promise<Record<string, number>> {
		if (!this._data) throw new Error('Storage not initialized');

		const pipeline = [{ $group: { _id: '$status', count: { $sum: 1 } } }];

		const cursor = this._data.aggregate(pipeline);
		const result = await cursor.toArray();

		const counts: Record<string, number> = {};
		for (const doc of result) {
			counts[doc._id] = doc.count;
		}

		return counts;
	}

	/**
	 * Get all documents with a specific status
	 * @param status Status to filter by
	 * @returns Object mapping document IDs to DocProcessingStatus
	 */
	public async getDocsByStatus(
		status: DocStatus,
	): Promise<Record<string, DocProcessingStatus>> {
		if (!this._data) throw new Error('Storage not initialized');

		const cursor = this._data.find({ status: status });
		const result = await cursor.toArray();

		const docs: Record<string, DocProcessingStatus> = {};
		for (const doc of result) {
			docs[doc._id] = {
				content: doc.content,
				content_summary: doc.content_summary,
				content_length: doc.content_length,
				status: doc.status,
				created_at: doc.created_at,
				updated_at: doc.updated_at,
				chunks_count: doc.chunks_count ?? -1,
			};
		}

		return docs;
	}

	/**
	 * Called when indexing is complete
	 */
	public async indexDoneCallback(): Promise<void> {
		// MongoDB handles persistence automatically, so nothing to do here
	}
}
