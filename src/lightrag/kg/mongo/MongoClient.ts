// ClientManager.ts
import { MongoClient, Db } from 'mongodb';
import { config } from '../../../config';

interface ClientManagerInstance {
	db: Db | null;
	refCount: number;
	client: MongoClient | null;
}

/**
 * Manages MongoDB client connections with reference counting
 */
export class ClientManager {
	private static instances: ClientManagerInstance = {
		db: null,
		client: null,
		refCount: 0,
	};
	private static lock = Promise.resolve();

	/**
	 * Get a MongoDB database instance
	 * @returns A MongoDB database instance
	 */
	public static async getClient(): Promise<Db> {
		// Using a Promise as a mutex lock
		let releaseLock;
		const newLock = new Promise<void>((resolve) => {
			releaseLock = resolve;
		});

		const oldLock = this.lock;
		this.lock = newLock;

		try {
			await oldLock;

			if (this.instances.db === null) {
				// Try to load config from environment or config file
				const uri = config.mongo.uri;
				const databaseName = config.mongo.database;

				const client = new MongoClient(uri);
				await client.connect();
				this.instances.db = client.db(databaseName);
				this.instances.client = client;
				this.instances.refCount = 0;

				console.debug(`MongoDB connection established to ${databaseName}`);
			}

			this.instances.refCount += 1;
			return this.instances.db;
		} finally {
			releaseLock!();
		}
	}

	/**
	 * Release a MongoDB database instance when no longer needed
	 * @param db The database instance to release
	 */
	public static async releaseClient(db: Db | null): Promise<void> {
		if (db === null) return;

		let releaseLock;
		const newLock = new Promise<void>((resolve) => {
			releaseLock = resolve;
		});

		const oldLock = this.lock;
		this.lock = newLock;

		try {
			await oldLock;

			if (db === this.instances.db) {
				this.instances.refCount -= 1;

				if (this.instances.refCount <= 0) {
					// Close connection when reference count reaches zero
					await this.instances.client.close();
					this.instances.db = null;
					this.instances.refCount = 0;
					this.instances.client = null;
					console.debug('MongoDB connection closed');
				}
			}
		} finally {
			releaseLock!();
		}
	}
}
