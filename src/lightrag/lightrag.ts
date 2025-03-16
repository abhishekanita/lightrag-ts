import { EventEmitter } from 'events';
import * as fs from 'fs';
import { format } from 'date-fns';
import * as _ from 'lodash';
import { STORAGES, verifyStorageImplementation } from './kg';
import {
	BaseGraphStorage,
	BaseKVStorage,
	BaseVectorStorage,
	DocProcessingStatus,
	DocStatus,
	DocStatusStorage,
	QueryParam,
	StorageNameSpace,
	StoragesStatus,
} from './base';
import { chunkingByTokenSize } from './operate';
import { NameSpace, makeNamespace } from './namespace';
import { PROMPTS } from './prompt';
import {
	checkStorageEnvVars,
	cleanText,
	computeMdHashId,
	convertResponseToJson,
	getContentSummary,
} from './utils';
import { extractEntities } from './operator/extract-entities';
import { naiveQuery } from './operator/query-naive';
import { kgQuery } from './operator/query-kg';

// Type definitions
export interface LightRAGConfig {
	workingDir?: string;
	kvStorage?: string;
	vectorStorage?: string;
	graphStorage?: string;
	docStatusStorage?: string;
	entityExtractMaxGleaning?: number;
	entitySummaryToMaxTokens?: number;
	chunkTokenSize?: number;
	chunkOverlapTokenSize?: number;
	tiktokenModelName?: string;
	chunkingFunc?: ChunkingFunc;
	nodeEmbeddingAlgorithm?: string;
	node2vecParams?: Node2VecParams;
	embeddingFunc?: any;
	embeddingBatchNum?: number;
	embeddingFuncMaxAsync?: number;
	embeddingCacheConfig?: EmbeddingCacheConfig;
	llmModelFunc?: LLMModelFunc;
	llmModelName?: string;
	llmModelMaxTokenSize?: number;
	llmModelMaxAsync?: number;
	llmModelKwargs?: Record<string, any>;
	vectorDbStorageClsKwargs?: Record<string, any>;
	namespacePrefix?: string;
	enableLlmCache?: boolean;
	enableLlmCacheForEntityExtract?: boolean;
	maxParallelInsert?: number;
	addonParams?: Record<string, any>;
	autoManageStoragesStates?: boolean;
	convertResponseToJsonFunc?: (response: string) => Record<string, any>;
	cosineBetterThanThreshold?: number;
}

interface Node2VecParams {
	dimensions: number;
	numWalks: number;
	walkLength: number;
	windowSize: number;
	iterations: number;
	randomSeed: number;
}

interface EmbeddingCacheConfig {
	enabled: boolean;
	similarityThreshold: number;
	useLlmCheck: boolean;
}

type ChunkingFunc = (
	content: string,
	splitByCharacter: string | null,
	splitByCharacterOnly: boolean,
	chunkOverlapTokenSize: number,
	chunkTokenSize: number,
	tiktokenModelName: string,
) => Array<Record<string, any>>;

type LLMModelFunc = (...args: any) => Promise<any>;

/**
 * LightRAG: Simple and Fast Retrieval-Augmented Generation.
 */
export class LightRAG {
	// Directory
	workingDir: string;

	// Storage
	kvStorage: string;
	vectorStorage: string;
	graphStorage: string;
	docStatusStorage: string;

	// Entity extraction
	entityExtractMaxGleaning: number;
	entitySummaryToMaxTokens: number;

	// Text chunking
	chunkTokenSize: number;
	chunkOverlapTokenSize: number;
	tiktokenModelName: string;
	chunkingFunc: ChunkingFunc;

	// Node embedding
	nodeEmbeddingAlgorithm: string;
	node2vecParams: Node2VecParams;

	// Embedding
	embeddingFunc: any;
	embeddingBatchNum: number;
	embeddingFuncMaxAsync: number;
	embeddingCacheConfig: EmbeddingCacheConfig;

	// LLM Configuration
	llmModelFunc: LLMModelFunc | null;
	llmModelName: string;
	llmModelMaxTokenSize: number;
	llmModelMaxAsync: number;
	llmModelKwargs: Record<string, any>;

	// Storage
	vectorDbStorageClsKwargs: Record<string, any>;
	namespacePrefix: string;
	enableLlmCache: boolean;
	enableLlmCacheForEntityExtract: boolean;

	// Extensions
	maxParallelInsert: number;
	addonParams: Record<string, any>;

	// Storages Management
	autoManageStoragesStates: boolean;
	convertResponseToJsonFunc: (response: string) => Record<string, any>;
	cosineBetterThanThreshold: number;

	_storagesStatus: StoragesStatus;

	// Storage instances
	keyStringValueJsonStorageCls: any;
	vectorDbStorageCls: any;
	graphStorageCls: any;
	docStatusStorageCls: any;

	llmResponseCache: BaseKVStorage;
	fullDocs: BaseKVStorage;
	textChunks: BaseKVStorage;
	chunkEntityRelationGraph: BaseGraphStorage;
	entitiesVdb: BaseVectorStorage;
	relationshipsVdb: BaseVectorStorage;
	chunksVdb: BaseVectorStorage;
	docStatus: DocStatusStorage;

	constructor(config: LightRAGConfig) {
		// Directory
		this.workingDir =
			config.workingDir ||
			`./lightrag_cache_${format(new Date(), 'yyyy-MM-dd-HH:mm:ss')}`;

		// Storage
		this.kvStorage = config.kvStorage || 'MongoKVStorage';
		this.vectorStorage = config.vectorStorage || 'MongoVectorDBStorage';
		this.graphStorage = config.graphStorage || 'MongoGraphStorage';
		this.docStatusStorage = config.docStatusStorage || 'MongoDocStatusStorage';

		// Entity extraction
		this.entityExtractMaxGleaning = config.entityExtractMaxGleaning || 1;
		this.entitySummaryToMaxTokens =
			config.entitySummaryToMaxTokens ||
			parseInt(process.env.MAX_TOKEN_SUMMARY || '500');

		// Text chunking
		this.chunkTokenSize =
			config.chunkTokenSize || parseInt(process.env.CHUNK_SIZE || '1200');
		this.chunkOverlapTokenSize =
			config.chunkOverlapTokenSize ||
			parseInt(process.env.CHUNK_OVERLAP_SIZE || '100');
		this.tiktokenModelName = config.tiktokenModelName || 'gpt-4o-mini';
		this.chunkingFunc = config.chunkingFunc || chunkingByTokenSize;

		// Node embedding
		this.nodeEmbeddingAlgorithm = config.nodeEmbeddingAlgorithm || 'node2vec';
		this.node2vecParams = config.node2vecParams || {
			dimensions: 1536,
			numWalks: 10,
			walkLength: 40,
			windowSize: 2,
			iterations: 3,
			randomSeed: 3,
		};

		// Embedding
		this.embeddingFunc = config.embeddingFunc;
		this.embeddingBatchNum = config.embeddingBatchNum || 32;
		this.embeddingFuncMaxAsync = config.embeddingFuncMaxAsync || 16;
		this.embeddingCacheConfig = config.embeddingCacheConfig || {
			enabled: false,
			similarityThreshold: 0.95,
			useLlmCheck: false,
		};

		// LLM Configuration
		this.llmModelFunc = config.llmModelFunc || null;
		this.llmModelName = config.llmModelName || 'gpt-4o-mini';
		this.llmModelMaxTokenSize =
			config.llmModelMaxTokenSize ||
			parseInt(process.env.MAX_TOKENS || '32768');
		this.llmModelMaxAsync =
			config.llmModelMaxAsync || parseInt(process.env.MAX_ASYNC || '16');
		this.llmModelKwargs = config.llmModelKwargs || {};

		// Storage
		this.vectorDbStorageClsKwargs = config.vectorDbStorageClsKwargs || {};
		this.namespacePrefix = config.namespacePrefix || '';
		this.enableLlmCache =
			config.enableLlmCache !== undefined ? config.enableLlmCache : true;
		this.enableLlmCacheForEntityExtract =
			config.enableLlmCacheForEntityExtract !== undefined
				? config.enableLlmCacheForEntityExtract
				: true;

		// Extensions
		this.maxParallelInsert =
			config.maxParallelInsert ||
			parseInt(process.env.MAX_PARALLEL_INSERT || '20');
		this.addonParams = config.addonParams || {
			language: process.env.SUMMARY_LANGUAGE || PROMPTS.DEFAULT_LANGUAGE,
		};

		// Storages Management
		this.autoManageStoragesStates =
			config.autoManageStoragesStates !== undefined
				? config.autoManageStoragesStates
				: true;

		this.convertResponseToJsonFunc =
			config.convertResponseToJsonFunc || convertResponseToJson;
		this.cosineBetterThanThreshold =
			config.cosineBetterThanThreshold ||
			parseFloat(process.env.COSINE_THRESHOLD || '0.2');

		this._storagesStatus = StoragesStatus.NOT_CREATED;
	}

	async initilaize() {
		if (!fs.existsSync(this.workingDir)) {
			console.log(`Creating working directory ${this.workingDir}`);
			fs.mkdirSync(this.workingDir);
		}

		const storageConfigs = [
			['KV_STORAGE', this.kvStorage],
			['VECTOR_STORAGE', this.vectorStorage],
			['GRAPH_STORAGE', this.graphStorage],
			['DOC_STATUS_STORAGE', this.docStatusStorage],
		];

		for (const [storageType, storageName] of storageConfigs) {
			verifyStorageImplementation(storageType, storageName);
			checkStorageEnvVars(storageName);
		}

		this.vectorDbStorageClsKwargs = {
			cosineBetterThanThreshold: this.cosineBetterThanThreshold,
			...this.vectorDbStorageClsKwargs,
		};

		const globalConfig = this.getConfig();
		const printConfig = Object.entries(globalConfig)
			.map(([k, v]) => `${k} = ${v}`)
			.join(',\n  ');

		// Limit async calls for embedding function
		// this.embeddingFunc = limitAsyncFuncCall(this.embeddingFuncMaxAsync)(
		// 	this.embeddingFunc as any,
		// );

		// Initialize all storages
		this.keyStringValueJsonStorageCls = await this._getStorageClass(
			this.kvStorage,
		);
		this.vectorDbStorageCls = await this._getStorageClass(this.vectorStorage);
		this.graphStorageCls = await this._getStorageClass(this.graphStorage);

		// const keyStringValueJsonStorageClsWithConfig = (...args: any[]) => {
		// 	return new this.keyStringValueJsonStorageCls(...args, { globalConfig });
		// };
		// const vectorDbStorageClsWithConfig = (...args: any[]) => {
		// 	return new this.vectorDbStorageCls(...args, { globalConfig });
		// };

		// const graphStorageClsWithConfig = (...args: any[]) => {
		// 	return new this.graphStorageCls(...args, { globalConfig });
		// };

		// this.keyStringValueJsonStorageCls = keyStringValueJsonStorageClsWithConfig;
		// this.vectorDbStorageCls = vectorDbStorageClsWithConfig;
		// this.graphStorageCls = graphStorageClsWithConfig;

		// Initialize document status storage
		this.docStatusStorageCls = await this._getStorageClass(
			this.docStatusStorage,
		);

		// Create storage instances
		this.llmResponseCache = new this.keyStringValueJsonStorageCls(
			makeNamespace(
				this.namespacePrefix,
				NameSpace.KV_STORE_LLM_RESPONSE_CACHE,
			),
			globalConfig,
			this.embeddingFunc,
		);

		this.fullDocs = new this.keyStringValueJsonStorageCls(
			makeNamespace(this.namespacePrefix, NameSpace.KV_STORE_FULL_DOCS),
			globalConfig,
			this.embeddingFunc,
		);

		this.textChunks = new this.keyStringValueJsonStorageCls(
			makeNamespace(this.namespacePrefix, NameSpace.KV_STORE_TEXT_CHUNKS),
			globalConfig,
			this.embeddingFunc,
		);

		this.chunkEntityRelationGraph = new this.graphStorageCls(
			makeNamespace(
				this.namespacePrefix,
				NameSpace.GRAPH_STORE_CHUNK_ENTITY_RELATION,
			),
			globalConfig,
			this.embeddingFunc,
		);

		this.entitiesVdb = new this.vectorDbStorageCls(
			makeNamespace(this.namespacePrefix, NameSpace.VECTOR_STORE_ENTITIES),
			globalConfig,
			this.embeddingFunc,
			['entity_name', 'source_id', 'content'],
		);

		this.relationshipsVdb = new this.vectorDbStorageCls(
			makeNamespace(
				this.namespacePrefix,
				NameSpace.VECTOR_STORE_RELATIONSHIPS,
			),
			globalConfig,
			this.embeddingFunc,
			['src_id', 'tgt_id', 'source_id', 'content'],
		);

		this.chunksVdb = new this.vectorDbStorageCls(
			makeNamespace(this.namespacePrefix, NameSpace.VECTOR_STORE_CHUNKS),
			globalConfig,
			this.embeddingFunc,
		);

		// Initialize document status storage
		this.docStatus = new this.docStatusStorageCls(
			makeNamespace(this.namespacePrefix, NameSpace.DOC_STATUS),
			globalConfig,
		);

		// Limit async calls for LLM function
		if (this.llmModelFunc) {
			// this.llmModelFunc = limitAsyncFuncCall(this.llmModelMaxAsync)(
			// 	async (...args: any[]) => {
			// 		return this.llmModelFunc!({
			// 			...args,
			// 			hashing_kv: this.llmResponseCache,
			// 			...this.llmModelKwargs,
			// 		});
			// 	},
			// );
		}

		this._storagesStatus = StoragesStatus.CREATED;

		if (this.autoManageStoragesStates) {
			this._runAsyncSafely(
				this.initializeStorages.bind(this),
				'Storage Initialization',
			);
		}

		// Set up cleanup on process exit
		process.on('exit', () => {
			if (this.autoManageStoragesStates) {
				this._runSyncSafely(
					this.finalizeStorages.bind(this),
					'Storage Finalization',
				);
			}
		});
	}

	async initializeStorages(): Promise<void> {
		if (this._storagesStatus === StoragesStatus.CREATED) {
			const tasks: Promise<void>[] = [];

			for (const storage of [
				this.fullDocs,
				this.textChunks,
				this.entitiesVdb,
				this.relationshipsVdb,
				this.chunksVdb,
				this.chunkEntityRelationGraph,
				this.llmResponseCache,
				this.docStatus,
			]) {
				if (storage) {
					tasks.push(storage.initialize());
				}
			}

			await Promise.all(tasks);

			this._storagesStatus = StoragesStatus.INITIALIZED;
			console.debug('Initialized Storages');
		}
	}

	async finalizeStorages(): Promise<void> {
		if (this._storagesStatus === StoragesStatus.INITIALIZED) {
			const tasks: Promise<void>[] = [];

			for (const storage of [
				this.fullDocs,
				this.textChunks,
				this.entitiesVdb,
				this.relationshipsVdb,
				this.chunksVdb,
				this.chunkEntityRelationGraph,
				this.llmResponseCache,
				this.docStatus,
			]) {
				if (storage) {
					tasks.push(storage.finalize());
				}
			}
			await Promise.all(tasks);
			this._storagesStatus = StoragesStatus.FINALIZED;
			console.debug('Finalized Storages');
		}
	}

	/**
	 * Sync Insert documents with checkpoint support
	 *
	 * @param input Single document string or list of document strings
	 * @param splitByCharacter If provided, split the string by this character
	 * @param splitByCharacterOnly If true, split the string by character only
	 * @param ids Single string of the document ID or list of unique document IDs, if not provided, MD5 hash IDs will be generated
	 */
	async insertDoc(
		input: string | string[],
		splitByCharacter: string | null = null,
		splitByCharacterOnly: boolean = false,
		ids?: string | string[],
	): Promise<void> {
		this.ainsert(input, splitByCharacter, splitByCharacterOnly, ids).catch(
			(err) => {
				console.error(`Error in insert: ${err}`);
			},
		);
	}
	/**
	 * Async Insert documents with checkpoint support
	 *
	 * @param input Single document string or list of document strings
	 * @param splitByCharacter If provided, split the string by this character
	 * @param splitByCharacterOnly If true, split the string by character only
	 * @param ids List of unique document IDs, if not provided, MD5 hash IDs will be generated
	 */
	async ainsert(
		input: string | string[],
		splitByCharacter: string | null = null,
		splitByCharacterOnly: boolean = false,
		ids?: string | string[],
	): Promise<void> {
		try {
			await this.apipelineEnqueueDocuments(input, ids);
			await this.apipelineProcessEnqueueDocuments(
				splitByCharacter,
				splitByCharacterOnly,
			);
		} catch (err) {
			console.log('Error in ainsert', err);
		}
	}

	/**
	 * Pipeline for Processing Documents
	 *
	 * 1. Validate ids if provided or generate MD5 hash IDs
	 * 2. Remove duplicate contents
	 * 3. Generate document initial status
	 * 4. Filter out already processed documents
	 * 5. Enqueue document in status
	 */
	async apipelineEnqueueDocuments(
		input: string | string[],
		ids?: string | string[],
	): Promise<void> {
		if (typeof input === 'string') {
			input = [input];
		}
		if (typeof ids === 'string') {
			ids = [ids];
		}

		// 1. Validate ids if provided or generate MD5 hash IDs
		let contents: Record<string, string> = {};

		if (ids) {
			// Check if the number of IDs matches the number of documents
			if (ids.length !== input.length) {
				throw new Error('Number of IDs must match the number of documents');
			}

			// Check if IDs are unique
			if (new Set(ids).size !== ids.length) {
				throw new Error('IDs must be unique');
			}

			// Generate contents dict of IDs provided by user and documents
			contents = Object.fromEntries(
				ids.map((id, index) => [id, input[index]]),
			);
		} else {
			// Clean input text and remove duplicates
			const uniqueInputs = Array.from(
				new Set(input.map((doc) => cleanText(doc))),
			);
			// Generate contents dict of MD5 hash IDs and documents
			contents = Object.fromEntries(
				uniqueInputs.map((doc) => [computeMdHashId(doc, 'doc-'), doc]),
			);
		}

		// 2. Remove duplicate contents
		const uniqueContentMap = new Map<string, string>();
		for (const [id, content] of Object.entries(contents)) {
			uniqueContentMap.set(content, id);
		}

		const uniqueContents: Record<string, string> = {};
		for (const [content, id] of uniqueContentMap.entries()) {
			uniqueContents[id] = content;
		}

		// 3. Generate document initial status
		const now = new Date().toISOString();
		const newDocs: Record<string, any> = {};

		for (const [id, content] of Object.entries(uniqueContents)) {
			newDocs[id] = {
				content,
				content_summary: getContentSummary(content),
				content_length: content.length,
				status: DocStatus.PENDING,
				created_at: now,
				updated_at: now,
			};
		}

		// 4. Filter out already processed documents
		const allNewDocIds = new Set(Object.keys(newDocs));
		const uniqueNewDocIds = await this.docStatus.filterKeys(allNewDocIds);

		// Log ignored document IDs
		const ignoredIds = Array.from(uniqueNewDocIds).filter(
			(docId) => !(docId in newDocs),
		);

		if (ignoredIds.length > 0) {
			console.warn(
				`Ignoring ${ignoredIds.length} document IDs not found in new_docs`,
			);
			for (const docId of ignoredIds) {
				console.warn(`Ignored document ID: ${docId}`);
			}
		}

		// Filter new_docs to only include documents with unique IDs
		const filteredNewDocs: Record<string, any> = {};
		for (const docId of uniqueNewDocIds) {
			if (docId in newDocs) {
				filteredNewDocs[docId] = newDocs[docId];
			}
		}

		if (Object.keys(filteredNewDocs).length === 0) {
			console.log('No new unique documents were found.');
			return;
		}

		// 5. Store status document
		await this.docStatus.upsert(filteredNewDocs);
		console.log(
			`Stored ${Object.keys(filteredNewDocs).length} new unique documents`,
		);
	}

	/**
	 * Process pending documents by splitting them into chunks, processing
	 * each chunk for entity and relation extraction, and updating the
	 * document status.
	 */
	async apipelineProcessEnqueueDocuments(
		splitByCharacter: string | null = null,
		splitByCharacterOnly: boolean = false,
	): Promise<void> {
		// Get pipeline status shared data and lock

		// Check if another process is already processing the queue
		let toProcessDocs: Record<string, DocProcessingStatus> = {};

		// Acquire lock
		const acquireLock = async (): Promise<boolean> => {
			return new Promise<boolean>((resolve) => {
				// Check if there are docs to process
				Promise.all([
					this.docStatus.getDocsByStatus(DocStatus.PROCESSING),
					this.docStatus.getDocsByStatus(DocStatus.FAILED),
					this.docStatus.getDocsByStatus(DocStatus.PENDING),
				]).then(([processingDocs, failedDocs, pendingDocs]) => {
					toProcessDocs = {};
					Object.assign(
						toProcessDocs,
						processingDocs,
						failedDocs,
						pendingDocs,
					);

					// If no docs to process, return but keep pipeline_status unchanged
					if (Object.keys(toProcessDocs).length === 0) {
						console.log('No documents to process');
						resolve(false);
						return;
					}
					resolve(true);
				});
			});
		};

		// Try to acquire lock
		const lockAcquired = await acquireLock();
		if (!lockAcquired) {
			return;
		}

		let logMessage = '';
		try {
			// Process documents until no more documents or requests
			// eslint-disable-next-line no-constant-condition
			while (true) {
				if (Object.keys(toProcessDocs).length === 0) {
					logMessage =
						'All documents have been processed or are duplicates';
					console.log(logMessage);
					break;
				}
				// Split docs into chunks, insert chunks, update doc status
				const docsBatches: Array<[string, DocProcessingStatus][]> = _.chunk(
					Object.entries(toProcessDocs),
					this.maxParallelInsert,
				);

				logMessage = `Number of batches to process: ${docsBatches.length}.`;
				console.log(logMessage);

				const batchPromises: Promise<void>[] = [];

				// Process each batch
				for (let batchIdx = 0; batchIdx < docsBatches.length; batchIdx++) {
					const processBatch = async (
						batchIdx: number,
						docsBatch: [string, DocProcessingStatus][],
						sizeBatch: number,
					): Promise<void> => {
						const logMessage = `Start processing batch ${batchIdx + 1} of ${sizeBatch}.`;
						console.log(logMessage);

						// Process each document in the batch
						for (const [docId, statusDoc] of docsBatch) {
							// Generate chunks from document
							const chunkResult = this.chunkingFunc(
								statusDoc.content,
								splitByCharacter,
								splitByCharacterOnly,
								this.chunkOverlapTokenSize,
								this.chunkTokenSize,
								this.tiktokenModelName,
							);

							const chunks: Record<string, any> = {};
							for (const dp of chunkResult) {
								const chunkId = computeMdHashId(
									dp.content,
									'chunk-',
								);
								chunks[chunkId] = {
									...dp,
									full_doc_id: docId,
								};
							}

							// Process document (text chunks and full docs) in parallel
							try {
								// Update document status to PROCESSING
								await this.docStatus.upsert({
									[docId]: {
										status: DocStatus.PROCESSING,
										updated_at: new Date().toISOString(),
										content: statusDoc.content,
										content_summary: statusDoc.content_summary,
										content_length: statusDoc.content_length,
										created_at: statusDoc.created_at,
									},
								});

								// Process everything in parallel
								await Promise.all([
									this.chunksVdb.upsert(chunks),
									this._processEntityRelationGraph(chunks),
									this.fullDocs.upsert({
										[docId]: { content: statusDoc.content },
									}),
									this.textChunks.upsert(chunks),
								]);

								// Update document status to PROCESSED
								await this.docStatus.upsert({
									[docId]: {
										status: DocStatus.PROCESSED,
										chunks_count: Object.keys(chunks).length,
										content: statusDoc.content,
										content_summary: statusDoc.content_summary,
										content_length: statusDoc.content_length,
										created_at: statusDoc.created_at,
										updated_at: new Date().toISOString(),
									},
								});
							} catch (e) {
								// Log error and update pipeline status
								const error = e as Error;
								const errorMsg = `Failed to process document ${docId}: ${error.message}`;
								console.error(errorMsg);
								console.log(e);
								// Update document status to failed
								await this.docStatus.upsert({
									[docId]: {
										status: DocStatus.FAILED,
										error: error.message,
										content: statusDoc.content,
										content_summary: statusDoc.content_summary,
										content_length: statusDoc.content_length,
										created_at: statusDoc.created_at,
										updated_at: new Date().toISOString(),
									},
								});
								break;
							}
						}

						const completionMessage = `Completed batch ${batchIdx + 1} of ${docsBatches.length}.`;
						console.log(completionMessage);
					};

					batchPromises.push(
						processBatch(
							batchIdx,
							docsBatches[batchIdx],
							docsBatches.length,
						),
					);
				}

				await Promise.all(batchPromises);
				await this._insertDone();

				logMessage =
					'Processing additional documents due to pending request';
				console.log(logMessage);

				// Check for pending documents again
				const [processingDocs, failedDocs, pendingDocs] = await Promise.all([
					this.docStatus.getDocsByStatus(DocStatus.PROCESSING),
					this.docStatus.getDocsByStatus(DocStatus.FAILED),
					this.docStatus.getDocsByStatus(DocStatus.PENDING),
				]);

				toProcessDocs = {};
				Object.assign(
					toProcessDocs,
					processingDocs,
					failedDocs,
					pendingDocs,
				);
			}
		} finally {
			const logMessage = 'Document processing pipeline completed';
			console.log(logMessage);
		}
	}

	async _processEntityRelationGraph(chunks: Record<string, any>): Promise<void> {
		await extractEntities(
			chunks,
			this.chunkEntityRelationGraph,
			this.entitiesVdb,
			this.relationshipsVdb,
			this.getConfig(),
			this.llmResponseCache,
		);
	}

	async _insertDone() {
		const tasks: Promise<void>[] = [];
		for (const storage of [
			this.fullDocs,
			this.textChunks,
			this.llmResponseCache,
			this.entitiesVdb,
			this.relationshipsVdb,
			this.chunksVdb,
			this.chunkEntityRelationGraph,
		]) {
			if (storage) {
				tasks.push((storage as StorageNameSpace).indexDoneCallback());
			}
		}
		await Promise.all(tasks);
	}

	async query(query: string, queryParam: QueryParam) {
		console.log('query', query);
		console.log('queryParam', queryParam);
		let response;
		if (queryParam.mode === 'naive') {
			response = await naiveQuery(
				query.trim(),
				this.chunksVdb,
				this.textChunks,
				queryParam,
				this.getConfig(),
				this.llmResponseCache,
			);
			console.log('response', response);
		}
		if (['local', 'global', 'hybrid'].includes(queryParam.mode)) {
			response = await kgQuery(
				query.trim(),
				this.chunkEntityRelationGraph,
				this.entitiesVdb,
				this.relationshipsVdb,
				this.textChunks,
				queryParam,
				this.getConfig(),
				this.llmResponseCache,
			);
		}
	}

	//
	// utility functions
	getConfig(): Record<string, any> {
		return {
			workingDir: this.workingDir,
			kvStorage: this.kvStorage,
			vectorStorage: this.vectorStorage,
			graphStorage: this.graphStorage,
			docStatusStorage: this.docStatusStorage,
			entityExtractMaxGleaning: this.entityExtractMaxGleaning,
			entitySummaryToMaxTokens: this.entitySummaryToMaxTokens,
			chunkTokenSize: this.chunkTokenSize,
			chunkOverlapTokenSize: this.chunkOverlapTokenSize,
			tiktokenModelName: this.tiktokenModelName,
			nodeEmbeddingAlgorithm: this.nodeEmbeddingAlgorithm,
			node2vecParams: this.node2vecParams,
			embeddingBatchNum: this.embeddingBatchNum,
			embeddingFuncMaxAsync: this.embeddingFuncMaxAsync,
			embeddingCacheConfig: this.embeddingCacheConfig,
			llmModelName: this.llmModelName,
			llmModelFunc: this.llmModelFunc,
			llmModelMaxTokenSize: this.llmModelMaxTokenSize,
			llmModelMaxAsync: this.llmModelMaxAsync,
			llmModelKwargs: this.llmModelKwargs,
			vectorDbStorageClsKwargs: this.vectorDbStorageClsKwargs,
			namespacePrefix: this.namespacePrefix,
			enableLlmCache: this.enableLlmCache,
			enableLlmCacheForEntityExtract: this.enableLlmCacheForEntityExtract,
			maxParallelInsert: this.maxParallelInsert,
			addonParams: this.addonParams,
			autoManageStoragesStates: this.autoManageStoragesStates,
			cosineBetterThanThreshold: this.cosineBetterThanThreshold,
		};
	}

	private _runAsyncSafely(asyncFunc: () => Promise<void>, actionName = ''): void {
		try {
			const event = new EventEmitter();
			const promise = asyncFunc();
			promise
				.then(() => {
					console.log(`${actionName} completed!`);
					event.emit('completed');
				})
				.catch((err) => {
					console.error(`Error in ${actionName}: ${err}`);
					event.emit('error', err);
				});
		} catch (error) {
			console.warn(`Error setting up ${actionName}: ${error}`);
		}
	}

	private _runSyncSafely(syncFunc: () => void, actionName = ''): void {
		try {
			syncFunc();
			console.log(`${actionName} completed!`);
		} catch (error) {
			console.error(`Error in ${actionName}: ${error}`);
		}
	}

	private async _getStorageClass(storageName: string): Promise<any> {
		const importPath = STORAGES[storageName];
		const module = await import(`../lightrag/kg/${importPath}`);
		return module[storageName];
	}
}
