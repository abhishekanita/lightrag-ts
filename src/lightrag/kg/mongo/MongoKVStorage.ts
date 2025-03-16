// MongoKVStorage.ts
import { Db, Collection } from 'mongodb';
import { ClientManager } from './MongoClient';
import { BaseKVStorage } from '../../base';
import { isNamespace, NameSpace } from '../../namespace';
import { getOrCreateCollection } from './utils';
import { LightRAGConfig } from '../../lightrag';

/**
 * MongoDB implementation of Key-Value Storage
 */
export class MongoKVStorage extends BaseKVStorage {
	public namespace: string;
	public global_config: LightRAGConfig;
	private db: Db | null = null;
	private _data: Collection<any> | null = null;
	private _collectionName: string;

	/**
	 * Creates a new MongoKVStorage instance
	 * @param namespace Storage namespace
	 * @param globalConfig Global configuration
	 */
	constructor(namespace: string, globalConfig: LightRAGConfig) {
		super(namespace, globalConfig, null);
		this.namespace = namespace;
		this.global_config = globalConfig;
		this._collectionName = namespace;
	}

	/**
	 * Initialize the storage
	 */
	public async initialize(): Promise<void> {
		if (this.db === null) {
			this.db = await ClientManager.getClient();
			this._data = await getOrCreateCollection(this.db, this._collectionName);
			console.debug(`Use MongoDB as KV ${this._collectionName}`);
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

		if (isNamespace(this.namespace, NameSpace.KV_STORE_LLM_RESPONSE_CACHE)) {
			const updatePromises: Promise<any>[] = [];

			for (const [mode, items] of Object.entries(data)) {
				for (const [k, v] of Object.entries(items)) {
					const key = `${mode}_${k}`;
					data[mode][k]._id = key;
					updatePromises.push(
						this._data.updateOne(
							{ _id: key },
							{ $setOnInsert: v },
							{ upsert: true },
						),
					);
				}
			}

			await Promise.all(updatePromises);
		} else {
			const updatePromises = Object.entries(data).map(([k, v]) => {
				data[k]._id = k;
				return this._data!.updateOne(
					{ _id: k },
					{ $set: v },
					{ upsert: true },
				);
			});

			await Promise.all(updatePromises);
		}
	}

	/**
	 * Get a document by mode and ID (specialized for LLM response cache)
	 * @param mode Mode/category
	 * @param id Document ID
	 * @returns Document or null if not found
	 */
	public async getByModeAndId(
		mode: string,
		id: string,
	): Promise<Record<string, any> | null> {
		if (!this._data) throw new Error('Storage not initialized');

		if (isNamespace(this.namespace, NameSpace.KV_STORE_LLM_RESPONSE_CACHE)) {
			const v = await this._data.findOne({ _id: mode + '_' + id });
			if (v) {
				const res: Record<string, any> = {};
				res[id] = v;
				console.debug(`llm_response_cache find one by: ${id}`);
				return res;
			} else {
				return null;
			}
		} else {
			return null;
		}
	}

	/**
	 * Called when indexing is complete
	 */
	public async indexDoneCallback(): Promise<void> {
		// MongoDB handles persistence automatically, so nothing to do here
	}
}
