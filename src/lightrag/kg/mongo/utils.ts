// utils.ts
import { Db } from 'mongodb';
import { MongoDBCollection } from './types';

/**
 * Gets an existing collection or creates a new one if it doesn't exist
 * @param db MongoDB database instance
 * @param collectionName Name of the collection to get or create
 * @returns MongoDB collection
 */
export async function getOrCreateCollection(
	db: Db,
	collectionName: string,
): Promise<MongoDBCollection> {
	const collections = await db.listCollections().toArray();
	const collectionExists = collections.some((col) => col.name === collectionName);

	if (!collectionExists) {
		await db.createCollection(collectionName);
		console.log(`Created collection: ${collectionName}`);
	} else {
		console.debug(`Collection '${collectionName}' already exists.`);
	}

	return db.collection(collectionName) as MongoDBCollection;
}
