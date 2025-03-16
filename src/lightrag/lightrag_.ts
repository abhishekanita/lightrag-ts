// import { EventEmitter } from 'events';
// import * as fs from 'fs';
// import { format } from 'date-fns';
// import * as dotenv from 'dotenv';
// import { write as csvWrite } from 'fast-csv';
// import * as ExcelJS from 'exceljs';
// import * as _ from 'lodash';
// import {
// 	STORAGE_ENV_REQUIREMENTS,
// 	STORAGES,
// 	verifyStorageImplementation,
// } from './kg';
// import {
// 	BaseGraphStorage,
// 	BaseKVStorage,
// 	BaseVectorStorage,
// 	DocProcessingStatus,
// 	DocStatus,
// 	DocStatusStorage,
// 	QueryParam,
// 	StorageNameSpace,
// 	StoragesStatus,
// } from './base';
// import { NameSpace, makeNamespace } from './namespace';

// import {
// 	chunkingByTokenSize,
// 	extractEntities,
// 	kgQuery,
// 	mixKgVectorQuery,
// 	naiveQuery,
// 	queryWithKeywords,
// } from './operate_';
// import { GRAPH_FIELD_SEP, PROMPTS } from './prompt';

// import {
// 	EmbeddingFunc,
// 	alwaysGetAnEventLoop,
// 	computeMdhashId,
// 	convertResponseToJson,
// 	encodeStringByTiktoken,
// 	lazyExternalImport,
// 	limitAsyncFuncCall,
// 	getContentSummary,
// 	cleanText,
// 	checkStorageEnvVars,
// 	logger,
// } from './utils';

// import { KnowledgeGraph } from './types';

// // Load environment variables
// dotenv.config({ override: true });

// // Type definitions
// interface LightRAGConfig {
// 	workingDir?: string;
// 	kvStorage?: string;
// 	vectorStorage?: string;
// 	graphStorage?: string;
// 	docStatusStorage?: string;
// 	entityExtractMaxGleaning?: number;
// 	entitySummaryToMaxTokens?: number;
// 	chunkTokenSize?: number;
// 	chunkOverlapTokenSize?: number;
// 	tiktokenModelName?: string;
// 	chunkingFunc?: ChunkingFunc;
// 	nodeEmbeddingAlgorithm?: string;
// 	node2vecParams?: Node2VecParams;
// 	embeddingFunc?: EmbeddingFunc;
// 	embeddingBatchNum?: number;
// 	embeddingFuncMaxAsync?: number;
// 	embeddingCacheConfig?: EmbeddingCacheConfig;
// 	llmModelFunc?: LLMModelFunc;
// 	llmModelName?: string;
// 	llmModelMaxTokenSize?: number;
// 	llmModelMaxAsync?: number;
// 	llmModelKwargs?: Record<string, any>;
// 	vectorDbStorageClsKwargs?: Record<string, any>;
// 	namespacePrefix?: string;
// 	enableLlmCache?: boolean;
// 	enableLlmCacheForEntityExtract?: boolean;
// 	maxParallelInsert?: number;
// 	addonParams?: Record<string, any>;
// 	autoManageStoragesStates?: boolean;
// 	convertResponseToJsonFunc?: (response: string) => Record<string, any>;
// 	cosineBetterThanThreshold?: number;
// }

// interface Node2VecParams {
// 	dimensions: number;
// 	numWalks: number;
// 	walkLength: number;
// 	windowSize: number;
// 	iterations: number;
// 	randomSeed: number;
// }

// interface EmbeddingCacheConfig {
// 	enabled: boolean;
// 	similarityThreshold: number;
// 	useLlmCheck: boolean;
// }

// type ChunkingFunc = (
// 	content: string,
// 	splitByCharacter: string | null,
// 	splitByCharacterOnly: boolean,
// 	chunkOverlapTokenSize: number,
// 	chunkTokenSize: number,
// 	tiktokenModelName: string,
// ) => Array<Record<string, any>>;

// type LLMModelFunc = (args: any) => Promise<any>;

// /**
//  * LightRAG: Simple and Fast Retrieval-Augmented Generation.
//  */
// export class LightRAG {
// 	// Directory
// 	workingDir: string;

// 	// Storage
// 	kvStorage: string;
// 	vectorStorage: string;
// 	graphStorage: string;
// 	docStatusStorage: string;

// 	// Entity extraction
// 	entityExtractMaxGleaning: number;
// 	entitySummaryToMaxTokens: number;

// 	// Text chunking
// 	chunkTokenSize: number;
// 	chunkOverlapTokenSize: number;
// 	tiktokenModelName: string;
// 	chunkingFunc: ChunkingFunc;

// 	// Node embedding
// 	nodeEmbeddingAlgorithm: string;
// 	node2vecParams: Node2VecParams;

// 	// Embedding
// 	embeddingFunc: EmbeddingFunc | null;
// 	embeddingBatchNum: number;
// 	embeddingFuncMaxAsync: number;
// 	embeddingCacheConfig: EmbeddingCacheConfig;

// 	// LLM Configuration
// 	llmModelFunc: LLMModelFunc | null;
// 	llmModelName: string;
// 	llmModelMaxTokenSize: number;
// 	llmModelMaxAsync: number;
// 	llmModelKwargs: Record<string, any>;

// 	// Storage
// 	vectorDbStorageClsKwargs: Record<string, any>;
// 	namespacePrefix: string;
// 	enableLlmCache: boolean;
// 	enableLlmCacheForEntityExtract: boolean;

// 	// Extensions
// 	maxParallelInsert: number;
// 	addonParams: Record<string, any>;

// 	// Storages Management
// 	autoManageStoragesStates: boolean;
// 	convertResponseToJsonFunc: (response: string) => Record<string, any>;
// 	cosineBetterThanThreshold: number;

// 	_storagesStatus: StoragesStatus;

// 	// Storage instances
// 	keyStringValueJsonStorageCls: any;
// 	vectorDbStorageCls: any;
// 	graphStorageCls: any;
// 	docStatusStorageCls: any;

// 	llmResponseCache: BaseKVStorage;
// 	fullDocs: BaseKVStorage;
// 	textChunks: BaseKVStorage;
// 	chunkEntityRelationGraph: BaseGraphStorage;
// 	entitiesVdb: BaseVectorStorage;
// 	relationshipsVdb: BaseVectorStorage;
// 	chunksVdb: BaseVectorStorage;
// 	docStatus: DocStatusStorage;

// 	private eventEmitter: EventEmitter;

// 	/**
// 	 * Creates a new LightRAG instance
// 	 * @param config Configuration options
// 	 */
// 	constructor(config: LightRAGConfig = {}) {
// 		// Set up event emitter for async handling
// 		this.eventEmitter = new EventEmitter();

// 		// Directory
// 		this.workingDir =
// 			config.workingDir ||
// 			`./lightrag_cache_${format(new Date(), 'yyyy-MM-dd-HH:mm:ss')}`;

// 		// Storage
// 		this.kvStorage = config.kvStorage || 'JsonKVStorage';
// 		this.vectorStorage = config.vectorStorage || 'NanoVectorDBStorage';
// 		this.graphStorage = config.graphStorage || 'NetworkXStorage';
// 		this.docStatusStorage = config.docStatusStorage || 'JsonDocStatusStorage';

// 		// Entity extraction
// 		this.entityExtractMaxGleaning = config.entityExtractMaxGleaning || 1;
// 		this.entitySummaryToMaxTokens =
// 			config.entitySummaryToMaxTokens ||
// 			parseInt(process.env.MAX_TOKEN_SUMMARY || '500');

// 		// Text chunking
// 		this.chunkTokenSize =
// 			config.chunkTokenSize || parseInt(process.env.CHUNK_SIZE || '1200');
// 		this.chunkOverlapTokenSize =
// 			config.chunkOverlapTokenSize ||
// 			parseInt(process.env.CHUNK_OVERLAP_SIZE || '100');
// 		this.tiktokenModelName = config.tiktokenModelName || 'gpt-4o-mini';
// 		this.chunkingFunc = config.chunkingFunc || chunkingByTokenSize;

// 		// Node embedding
// 		this.nodeEmbeddingAlgorithm = config.nodeEmbeddingAlgorithm || 'node2vec';
// 		this.node2vecParams = config.node2vecParams || {
// 			dimensions: 1536,
// 			numWalks: 10,
// 			walkLength: 40,
// 			windowSize: 2,
// 			iterations: 3,
// 			randomSeed: 3,
// 		};

// 		// Embedding
// 		this.embeddingFunc = config.embeddingFunc || null;
// 		this.embeddingBatchNum = config.embeddingBatchNum || 32;
// 		this.embeddingFuncMaxAsync = config.embeddingFuncMaxAsync || 16;
// 		this.embeddingCacheConfig = config.embeddingCacheConfig || {
// 			enabled: false,
// 			similarityThreshold: 0.95,
// 			useLlmCheck: false,
// 		};

// 		// LLM Configuration
// 		this.llmModelFunc = config.llmModelFunc || null;
// 		this.llmModelName = config.llmModelName || 'gpt-4o-mini';
// 		this.llmModelMaxTokenSize =
// 			config.llmModelMaxTokenSize ||
// 			parseInt(process.env.MAX_TOKENS || '32768');
// 		this.llmModelMaxAsync =
// 			config.llmModelMaxAsync || parseInt(process.env.MAX_ASYNC || '16');
// 		this.llmModelKwargs = config.llmModelKwargs || {};

// 		// Storage
// 		this.vectorDbStorageClsKwargs = config.vectorDbStorageClsKwargs || {};
// 		this.namespacePrefix = config.namespacePrefix || '';
// 		this.enableLlmCache =
// 			config.enableLlmCache !== undefined ? config.enableLlmCache : true;
// 		this.enableLlmCacheForEntityExtract =
// 			config.enableLlmCacheForEntityExtract !== undefined
// 				? config.enableLlmCacheForEntityExtract
// 				: true;

// 		// Extensions
// 		this.maxParallelInsert =
// 			config.maxParallelInsert ||
// 			parseInt(process.env.MAX_PARALLEL_INSERT || '20');
// 		this.addonParams = config.addonParams || {
// 			language: process.env.SUMMARY_LANGUAGE || PROMPTS.DEFAULT_LANGUAGE,
// 		};

// 		// Storages Management
// 		this.autoManageStoragesStates =
// 			config.autoManageStoragesStates !== undefined
// 				? config.autoManageStoragesStates
// 				: true;

// 		this.convertResponseToJsonFunc =
// 			config.convertResponseToJsonFunc || convertResponseToJson;
// 		this.cosineBetterThanThreshold =
// 			config.cosineBetterThanThreshold ||
// 			parseFloat(process.env.COSINE_THRESHOLD || '0.2');

// 		this._storagesStatus = StoragesStatus.NOT_CREATED;

// 		// Initialize everything
// 		this.initializeStorages();
// 	}

// 	/**
// 	 * Initialize storages and set up the LightRAG instance
// 	 */
// 	private initializeStorages(): void {
// 		// Import and initialize shared data

// 		// Create working directory if it doesn't exist
// 		if (!fs.existsSync(this.workingDir)) {
// 			logger.info(`Creating working directory ${this.workingDir}`);
// 			fs.mkdirpSync(this.workingDir);
// 		}

// 		// Verify storage implementation compatibility and environment variables
// 		const storageConfigs = [
// 			['KV_STORAGE', this.kvStorage],
// 			['VECTOR_STORAGE', this.vectorStorage],
// 			['GRAPH_STORAGE', this.graphStorage],
// 			['DOC_STATUS_STORAGE', this.docStatusStorage],
// 		];

// 		for (const [storageType, storageName] of storageConfigs) {
// 			// Verify storage implementation compatibility
// 			verifyStorageImplementation(storageType, storageName);
// 			// Check environment variables
// 			checkStorageEnvVars(storageName);
// 		}

// 		// Ensure vector_db_storage_cls_kwargs has required fields
// 		this.vectorDbStorageClsKwargs = {
// 			cosineBetterThanThreshold: this.cosineBetterThanThreshold,
// 			...this.vectorDbStorageClsKwargs,
// 		};

// 		// Show config
// 		const globalConfig = this.getConfig();
// 		const printConfig = Object.entries(globalConfig)
// 			.map(([k, v]) => `${k} = ${v}`)
// 			.join(',\n  ');
// 		logger.debug(`LightRAG init with param:\n  ${printConfig}\n`);

// 		// Limit async calls for embedding function
// 		if (this.embeddingFunc) {
// 			this.embeddingFunc = limitAsyncFuncCall(this.embeddingFuncMaxAsync)(
// 				this.embeddingFunc,
// 			);
// 		}

// 		// Initialize all storages
// 		this.keyStringValueJsonStorageCls = this._getStorageClass(this.kvStorage);
// 		this.vectorDbStorageCls = this._getStorageClass(this.vectorStorage);
// 		this.graphStorageCls = this._getStorageClass(this.graphStorage);

// 		// Bind global config to storage class constructors
// 		const keyStringValueJsonStorageClsWithConfig = (...args: any[]) => {
// 			return new this.keyStringValueJsonStorageCls(...args, { globalConfig });
// 		};

// 		const vectorDbStorageClsWithConfig = (...args: any[]) => {
// 			return new this.vectorDbStorageCls(...args, { globalConfig });
// 		};

// 		const graphStorageClsWithConfig = (...args: any[]) => {
// 			return new this.graphStorageCls(...args, { globalConfig });
// 		};

// 		this.keyStringValueJsonStorageCls = keyStringValueJsonStorageClsWithConfig;
// 		this.vectorDbStorageCls = vectorDbStorageClsWithConfig;
// 		this.graphStorageCls = graphStorageClsWithConfig;

// 		// Initialize document status storage
// 		this.docStatusStorageCls = this._getStorageClass(this.docStatusStorage);

// 		// Create storage instances
// 		this.llmResponseCache = this.keyStringValueJsonStorageCls({
// 			namespace: makeNamespace(
// 				this.namespacePrefix,
// 				NameSpace.KV_STORE_LLM_RESPONSE_CACHE,
// 			),
// 			globalConfig: this.getConfig(),
// 			embeddingFunc: this.embeddingFunc,
// 		});

// 		this.fullDocs = this.keyStringValueJsonStorageCls({
// 			namespace: makeNamespace(
// 				this.namespacePrefix,
// 				NameSpace.KV_STORE_FULL_DOCS,
// 			),
// 			embeddingFunc: this.embeddingFunc,
// 		});

// 		this.textChunks = this.keyStringValueJsonStorageCls({
// 			namespace: makeNamespace(
// 				this.namespacePrefix,
// 				NameSpace.KV_STORE_TEXT_CHUNKS,
// 			),
// 			embeddingFunc: this.embeddingFunc,
// 		});

// 		this.chunkEntityRelationGraph = this.graphStorageCls({
// 			namespace: makeNamespace(
// 				this.namespacePrefix,
// 				NameSpace.GRAPH_STORE_CHUNK_ENTITY_RELATION,
// 			),
// 			embeddingFunc: this.embeddingFunc,
// 		});

// 		this.entitiesVdb = this.vectorDbStorageCls({
// 			namespace: makeNamespace(
// 				this.namespacePrefix,
// 				NameSpace.VECTOR_STORE_ENTITIES,
// 			),
// 			embeddingFunc: this.embeddingFunc,
// 			metaFields: new Set(['entity_name', 'source_id', 'content']),
// 		});

// 		this.relationshipsVdb = this.vectorDbStorageCls({
// 			namespace: makeNamespace(
// 				this.namespacePrefix,
// 				NameSpace.VECTOR_STORE_RELATIONSHIPS,
// 			),
// 			embeddingFunc: this.embeddingFunc,
// 			metaFields: new Set(['src_id', 'tgt_id', 'source_id', 'content']),
// 		});

// 		this.chunksVdb = this.vectorDbStorageCls({
// 			namespace: makeNamespace(
// 				this.namespacePrefix,
// 				NameSpace.VECTOR_STORE_CHUNKS,
// 			),
// 			embeddingFunc: this.embeddingFunc,
// 		});

// 		// Initialize document status storage
// 		this.docStatus = new this.docStatusStorageCls({
// 			namespace: makeNamespace(this.namespacePrefix, NameSpace.DOC_STATUS),
// 			globalConfig,
// 			embeddingFunc: null,
// 		});

// 		// Limit async calls for LLM function
// 		if (this.llmModelFunc) {
// 			this.llmModelFunc = limitAsyncFuncCall(this.llmModelMaxAsync)(
// 				async (...args: any[]) => {
// 					return this.llmModelFunc!({
// 						...args,
// 						hashing_kv: this.llmResponseCache,
// 						...this.llmModelKwargs,
// 					});
// 				},
// 			);
// 		}

// 		this._storagesStatus = StoragesStatus.CREATED;

// 		// Initialize storages if auto-management is enabled
// 		if (this.autoManageStoragesStates) {
// 			this._runAsyncSafely(
// 				this.initializeStorages.bind(this),
// 				'Storage Initialization',
// 			);
// 		}

// 		// Set up cleanup on process exit
// 		process.on('exit', () => {
// 			if (this.autoManageStoragesStates) {
// 				// We need to run finalizeStorages synchronously on exit
// 				this._runSyncSafely(
// 					this.finalizeStorages.bind(this),
// 					'Storage Finalization',
// 				);
// 			}
// 		});
// 	}

// 	/**
// 	 * Get the complete configuration as an object
// 	 */
// 	getConfig(): Record<string, any> {
// 		return {
// 			workingDir: this.workingDir,
// 			kvStorage: this.kvStorage,
// 			vectorStorage: this.vectorStorage,
// 			graphStorage: this.graphStorage,
// 			docStatusStorage: this.docStatusStorage,
// 			entityExtractMaxGleaning: this.entityExtractMaxGleaning,
// 			entitySummaryToMaxTokens: this.entitySummaryToMaxTokens,
// 			chunkTokenSize: this.chunkTokenSize,
// 			chunkOverlapTokenSize: this.chunkOverlapTokenSize,
// 			tiktokenModelName: this.tiktokenModelName,
// 			nodeEmbeddingAlgorithm: this.nodeEmbeddingAlgorithm,
// 			node2vecParams: this.node2vecParams,
// 			embeddingBatchNum: this.embeddingBatchNum,
// 			embeddingFuncMaxAsync: this.embeddingFuncMaxAsync,
// 			embeddingCacheConfig: this.embeddingCacheConfig,
// 			llmModelName: this.llmModelName,
// 			llmModelMaxTokenSize: this.llmModelMaxTokenSize,
// 			llmModelMaxAsync: this.llmModelMaxAsync,
// 			llmModelKwargs: this.llmModelKwargs,
// 			vectorDbStorageClsKwargs: this.vectorDbStorageClsKwargs,
// 			namespacePrefix: this.namespacePrefix,
// 			enableLlmCache: this.enableLlmCache,
// 			enableLlmCacheForEntityExtract: this.enableLlmCacheForEntityExtract,
// 			maxParallelInsert: this.maxParallelInsert,
// 			addonParams: this.addonParams,
// 			autoManageStoragesStates: this.autoManageStoragesStates,
// 			cosineBetterThanThreshold: this.cosineBetterThanThreshold,
// 		};
// 	}

// 	/**
// 	 * Safely execute an async function, avoiding event loop conflicts
// 	 */
// 	private _runAsyncSafely(asyncFunc: () => Promise<void>, actionName = ''): void {
// 		try {
// 			const event = new EventEmitter();
// 			const promise = asyncFunc();
// 			promise
// 				.then(() => {
// 					logger.info(`${actionName} completed!`);
// 					event.emit('completed');
// 				})
// 				.catch((err) => {
// 					logger.error(`Error in ${actionName}: ${err}`);
// 					event.emit('error', err);
// 				});
// 		} catch (error) {
// 			logger.warning(`Error setting up ${actionName}: ${error}`);
// 		}
// 	}

// 	/**
// 	 * Safely execute a sync function for cleanup
// 	 */
// 	private _runSyncSafely(syncFunc: () => void, actionName = ''): void {
// 		try {
// 			syncFunc();
// 			logger.info(`${actionName} completed!`);
// 		} catch (error) {
// 			logger.error(`Error in ${actionName}: ${error}`);
// 		}
// 	}

// 	/**
// 	 * Asynchronously initialize the storages
// 	 */
// 	async initializeStorages(): Promise<void> {
// 		if (this._storagesStatus === StoragesStatus.CREATED) {
// 			const tasks: Promise<void>[] = [];

// 			for (const storage of [
// 				this.fullDocs,
// 				this.textChunks,
// 				this.entitiesVdb,
// 				this.relationshipsVdb,
// 				this.chunksVdb,
// 				this.chunkEntityRelationGraph,
// 				this.llmResponseCache,
// 				this.docStatus,
// 			]) {
// 				if (storage) {
// 					tasks.push(storage.initialize());
// 				}
// 			}

// 			await Promise.all(tasks);

// 			this._storagesStatus = StoragesStatus.INITIALIZED;
// 			logger.debug('Initialized Storages');
// 		}
// 	}

// 	/**
// 	 * Asynchronously finalize the storages
// 	 */
// 	async finalizeStorages(): Promise<void> {
// 		if (this._storagesStatus === StoragesStatus.INITIALIZED) {
// 			const tasks: Promise<void>[] = [];

// 			for (const storage of [
// 				this.fullDocs,
// 				this.textChunks,
// 				this.entitiesVdb,
// 				this.relationshipsVdb,
// 				this.chunksVdb,
// 				this.chunkEntityRelationGraph,
// 				this.llmResponseCache,
// 				this.docStatus,
// 			]) {
// 				if (storage) {
// 					tasks.push(storage.finalize());
// 				}
// 			}

// 			await Promise.all(tasks);

// 			this._storagesStatus = StoragesStatus.FINALIZED;
// 			logger.debug('Finalized Storages');
// 		}
// 	}

// 	/**
// 	 * Get all graph labels
// 	 */
// 	async getGraphLabels(): Promise<string[]> {
// 		return this.chunkEntityRelationGraph.getAllLabels();
// 	}

// 	/**
// 	 * Get knowledge graph for a given label
// 	 *
// 	 * @param nodeLabel Label to get knowledge graph for
// 	 * @param maxDepth Maximum depth of graph
// 	 * @param minDegree Minimum degree of nodes to include
// 	 * @param inclusive Whether to use inclusive search mode
// 	 * @returns Knowledge graph containing nodes and edges
// 	 */
// 	async getKnowledgeGraph(
// 		nodeLabel: string,
// 		maxDepth: number = 3,
// 		minDegree: number = 0,
// 		inclusive: boolean = false,
// 	): Promise<KnowledgeGraph> {
// 		// Build args based on supported parameters
// 		const kwargs: Record<string, any> = { nodeLabel, maxDepth };

// 		if (minDegree > 0) {
// 			kwargs.minDegree = minDegree;
// 		}

// 		kwargs.inclusive = inclusive;

// 		return this.chunkEntityRelationGraph.getKnowledgeGraph(kwargs);
// 	}

// 	/**
// 	 * Get a storage class by name
// 	 */
// 	private _getStorageClass(storageName: string): any {
// 		const importPath = STORAGES[storageName];
// 		return lazyExternalImport(importPath, storageName);
// 	}

// 	/**
// 	 * Sync Insert documents with checkpoint support
// 	 *
// 	 * @param input Single document string or list of document strings
// 	 * @param splitByCharacter If provided, split the string by this character
// 	 * @param splitByCharacterOnly If true, split the string by character only
// 	 * @param ids Single string of the document ID or list of unique document IDs, if not provided, MD5 hash IDs will be generated
// 	 */
// 	insert(
// 		input: string | string[],
// 		splitByCharacter: string | null = null,
// 		splitByCharacterOnly: boolean = false,
// 		ids?: string | string[],
// 	): void {
// 		this.ainsert(input, splitByCharacter, splitByCharacterOnly, ids).catch(
// 			(err) => {
// 				logger.error(`Error in insert: ${err}`);
// 			},
// 		);
// 	}

// 	/**
// 	 * Async Insert documents with checkpoint support
// 	 *
// 	 * @param input Single document string or list of document strings
// 	 * @param splitByCharacter If provided, split the string by this character
// 	 * @param splitByCharacterOnly If true, split the string by character only
// 	 * @param ids List of unique document IDs, if not provided, MD5 hash IDs will be generated
// 	 */
// 	async ainsert(
// 		input: string | string[],
// 		splitByCharacter: string | null = null,
// 		splitByCharacterOnly: boolean = false,
// 		ids?: string | string[],
// 	): Promise<void> {
// 		await this.apipelineEnqueueDocuments(input, ids);
// 		await this.apipelineProcessEnqueueDocuments(
// 			splitByCharacter,
// 			splitByCharacterOnly,
// 		);
// 	}

// 	/**
// 	 * Insert custom chunks (deprecated, use insert instead)
// 	 */
// 	insertCustomChunks(
// 		fullText: string,
// 		textChunks: string[],
// 		docId?: string | string[],
// 	): void {
// 		this.ainsertCustomChunks(
// 			fullText,
// 			textChunks,
// 			typeof docId === 'string' ? docId : undefined,
// 		).catch((err) => {
// 			logger.error(`Error in insertCustomChunks: ${err}`);
// 		});
// 	}

// 	/**
// 	 * Async insert custom chunks (deprecated, use ainsert instead)
// 	 */
// 	async ainsertCustomChunks(
// 		fullText: string,
// 		textChunks: string[],
// 		docId?: string,
// 	): Promise<void> {
// 		let updateStorage = false;
// 		try {
// 			// Clean input texts
// 			fullText = cleanText(fullText);
// 			textChunks = textChunks.map((chunk) => cleanText(chunk));

// 			// Process cleaned texts
// 			const docKey = docId || computeMdhashId(fullText, 'doc-');
// 			const newDocs: Record<string, any> = { [docKey]: { content: fullText } };

// 			const addDocKeys = await this.fullDocs.filterKeys(new Set([docKey]));
// 			const filteredNewDocs: Record<string, any> = {};
// 			for (const [k, v] of Object.entries(newDocs)) {
// 				if (addDocKeys.has(k)) {
// 					filteredNewDocs[k] = v;
// 				}
// 			}

// 			if (Object.keys(filteredNewDocs).length === 0) {
// 				logger.warning('This document is already in the storage.');
// 				return;
// 			}

// 			updateStorage = true;
// 			logger.info(`Inserting ${Object.keys(filteredNewDocs).length} docs`);

// 			const insertingChunks: Record<string, any> = {};
// 			for (const chunkText of textChunks) {
// 				const chunkKey = computeMdhashId(chunkText, 'chunk-');
// 				insertingChunks[chunkKey] = {
// 					content: chunkText,
// 					full_doc_id: docKey,
// 				};
// 			}

// 			const docIds = new Set(Object.keys(insertingChunks));
// 			const addChunkKeys = await this.textChunks.filterKeys(docIds);
// 			const filteredInsertingChunks: Record<string, any> = {};

// 			for (const [k, v] of Object.entries(insertingChunks)) {
// 				if (addChunkKeys.has(k)) {
// 					filteredInsertingChunks[k] = v;
// 				}
// 			}

// 			if (Object.keys(filteredInsertingChunks).length === 0) {
// 				logger.warning('All chunks are already in the storage.');
// 				return;
// 			}

// 			const tasks = [
// 				this.chunksVdb.upsert(filteredInsertingChunks),
// 				this._processEntityRelationGraph(filteredInsertingChunks),
// 				this.fullDocs.upsert(filteredNewDocs),
// 				this.textChunks.upsert(filteredInsertingChunks),
// 			];

// 			await Promise.all(tasks);
// 		} finally {
// 			if (updateStorage) {
// 				await this._insertDone();
// 			}
// 		}
// 	}

// 	/**
// 	 * Pipeline for Processing Documents
// 	 *
// 	 * 1. Validate ids if provided or generate MD5 hash IDs
// 	 * 2. Remove duplicate contents
// 	 * 3. Generate document initial status
// 	 * 4. Filter out already processed documents
// 	 * 5. Enqueue document in status
// 	 */
// 	async apipelineEnqueueDocuments(
// 		input: string | string[],
// 		ids?: string | string[],
// 	): Promise<void> {
// 		if (typeof input === 'string') {
// 			input = [input];
// 		}
// 		if (typeof ids === 'string') {
// 			ids = [ids];
// 		}

// 		// 1. Validate ids if provided or generate MD5 hash IDs
// 		let contents: Record<string, string> = {};

// 		if (ids) {
// 			// Check if the number of IDs matches the number of documents
// 			if (ids.length !== input.length) {
// 				throw new Error('Number of IDs must match the number of documents');
// 			}

// 			// Check if IDs are unique
// 			if (new Set(ids).size !== ids.length) {
// 				throw new Error('IDs must be unique');
// 			}

// 			// Generate contents dict of IDs provided by user and documents
// 			contents = Object.fromEntries(
// 				ids.map((id, index) => [id, input[index]]),
// 			);
// 		} else {
// 			// Clean input text and remove duplicates
// 			const uniqueInputs = Array.from(
// 				new Set(input.map((doc) => cleanText(doc))),
// 			);
// 			// Generate contents dict of MD5 hash IDs and documents
// 			contents = Object.fromEntries(
// 				uniqueInputs.map((doc) => [computeMdhashId(doc, 'doc-'), doc]),
// 			);
// 		}

// 		// 2. Remove duplicate contents
// 		const uniqueContentMap = new Map<string, string>();
// 		for (const [id, content] of Object.entries(contents)) {
// 			uniqueContentMap.set(content, id);
// 		}

// 		const uniqueContents: Record<string, string> = {};
// 		for (const [content, id] of uniqueContentMap.entries()) {
// 			uniqueContents[id] = content;
// 		}

// 		// 3. Generate document initial status
// 		const now = new Date().toISOString();
// 		const newDocs: Record<string, any> = {};

// 		for (const [id, content] of Object.entries(uniqueContents)) {
// 			newDocs[id] = {
// 				content,
// 				content_summary: getContentSummary(content),
// 				content_length: content.length,
// 				status: DocStatus.PENDING,
// 				created_at: now,
// 				updated_at: now,
// 			};
// 		}

// 		// 4. Filter out already processed documents
// 		const allNewDocIds = new Set(Object.keys(newDocs));
// 		const uniqueNewDocIds = await this.docStatus.filterKeys(allNewDocIds);

// 		// Log ignored document IDs
// 		const ignoredIds = Array.from(uniqueNewDocIds).filter(
// 			(docId) => !(docId in newDocs),
// 		);

// 		if (ignoredIds.length > 0) {
// 			logger.warning(
// 				`Ignoring ${ignoredIds.length} document IDs not found in new_docs`,
// 			);
// 			for (const docId of ignoredIds) {
// 				logger.warning(`Ignored document ID: ${docId}`);
// 			}
// 		}

// 		// Filter new_docs to only include documents with unique IDs
// 		const filteredNewDocs: Record<string, any> = {};
// 		for (const docId of uniqueNewDocIds) {
// 			if (docId in newDocs) {
// 				filteredNewDocs[docId] = newDocs[docId];
// 			}
// 		}

// 		if (Object.keys(filteredNewDocs).length === 0) {
// 			logger.info('No new unique documents were found.');
// 			return;
// 		}

// 		// 5. Store status document
// 		await this.docStatus.upsert(filteredNewDocs);
// 		logger.info(
// 			`Stored ${Object.keys(filteredNewDocs).length} new unique documents`,
// 		);
// 	}

// 	/**
// 	 * Process pending documents by splitting them into chunks, processing
// 	 * each chunk for entity and relation extraction, and updating the
// 	 * document status.
// 	 */
// 	async apipelineProcessEnqueueDocuments(
// 		splitByCharacter: string | null = null,
// 		splitByCharacterOnly: boolean = false,
// 	): Promise<void> {
// 		// Get pipeline status shared data and lock
// 		const {
// 			getNamespaceData,
// 			getPipelineStatusLock,
// 		} = require('./kg/shared_storage');

// 		const pipelineStatus = await getNamespaceData('pipeline_status');
// 		const pipelineStatusLock = getPipelineStatusLock();

// 		// Check if another process is already processing the queue
// 		let toProcessDocs: Record<string, DocProcessingStatus> = {};

// 		// Acquire lock
// 		const acquireLock = async (): Promise<boolean> => {
// 			return new Promise<boolean>((resolve) => {
// 				if (!pipelineStatus.busy) {
// 					// Check if there are docs to process
// 					Promise.all([
// 						this.docStatus.getDocsByStatus(DocStatus.PROCESSING),
// 						this.docStatus.getDocsByStatus(DocStatus.FAILED),
// 						this.docStatus.getDocsByStatus(DocStatus.PENDING),
// 					]).then(([processingDocs, failedDocs, pendingDocs]) => {
// 						toProcessDocs = {};
// 						Object.assign(
// 							toProcessDocs,
// 							processingDocs,
// 							failedDocs,
// 							pendingDocs,
// 						);

// 						// If no docs to process, return but keep pipeline_status unchanged
// 						if (Object.keys(toProcessDocs).length === 0) {
// 							logger.info('No documents to process');
// 							resolve(false);
// 							return;
// 						}

// 						// Update pipeline_status to indicate processing
// 						pipelineStatus.busy = true;
// 						pipelineStatus.job_name = 'indexing files';
// 						pipelineStatus.job_start = new Date().toISOString();
// 						pipelineStatus.docs = 0;
// 						pipelineStatus.batchs = 0;
// 						pipelineStatus.cur_batch = 0;
// 						pipelineStatus.request_pending = false; // Clear any previous request
// 						pipelineStatus.latest_message = '';

// 						// Clear history_messages array
// 						pipelineStatus.history_messages.length = 0;

// 						resolve(true);
// 					});
// 				} else {
// 					// Another process is busy, set request flag and return
// 					pipelineStatus.request_pending = true;
// 					logger.info(
// 						'Another process is already processing the document queue. Request queued.',
// 					);
// 					resolve(false);
// 				}
// 			});
// 		};

// 		// Try to acquire lock
// 		const lockAcquired = await acquireLock();
// 		if (!lockAcquired) {
// 			return;
// 		}

// 		try {
// 			// Process documents until no more documents or requests
// 			while (true) {
// 				if (Object.keys(toProcessDocs).length === 0) {
// 					const logMessage =
// 						'All documents have been processed or are duplicates';
// 					logger.info(logMessage);
// 					pipelineStatus.latest_message = logMessage;
// 					pipelineStatus.history_messages.push(logMessage);
// 					break;
// 				}

// 				// Split docs into chunks, insert chunks, update doc status
// 				const docsBatches: Array<[string, DocProcessingStatus][]> = _.chunk(
// 					Object.entries(toProcessDocs),
// 					this.maxParallelInsert,
// 				);

// 				const logMessage = `Number of batches to process: ${docsBatches.length}.`;
// 				logger.info(logMessage);

// 				// Update pipeline status with current batch information
// 				pipelineStatus.docs += Object.keys(toProcessDocs).length;
// 				pipelineStatus.batchs += docsBatches.length;
// 				pipelineStatus.latest_message = logMessage;
// 				pipelineStatus.history_messages.push(logMessage);

// 				const batchPromises: Promise<void>[] = [];

// 				// Process each batch
// 				for (let batchIdx = 0; batchIdx < docsBatches.length; batchIdx++) {
// 					const processBatch = async (
// 						batchIdx: number,
// 						docsBatch: [string, DocProcessingStatus][],
// 						sizeBatch: number,
// 					): Promise<void> => {
// 						const logMessage = `Start processing batch ${batchIdx + 1} of ${sizeBatch}.`;
// 						logger.info(logMessage);
// 						pipelineStatus.latest_message = logMessage;
// 						pipelineStatus.history_messages.push(logMessage);

// 						// Process each document in the batch
// 						for (const [docId, statusDoc] of docsBatch) {
// 							// Generate chunks from document
// 							const chunkResult = this.chunkingFunc(
// 								statusDoc.content,
// 								splitByCharacter,
// 								splitByCharacterOnly,
// 								this.chunkOverlapTokenSize,
// 								this.chunkTokenSize,
// 								this.tiktokenModelName,
// 							);

// 							const chunks: Record<string, any> = {};
// 							for (const dp of chunkResult) {
// 								const chunkId = computeMdhashId(
// 									dp.content,
// 									'chunk-',
// 								);
// 								chunks[chunkId] = {
// 									...dp,
// 									full_doc_id: docId,
// 								};
// 							}

// 							// Process document (text chunks and full docs) in parallel
// 							try {
// 								// Update document status to PROCESSING
// 								await this.docStatus.upsert({
// 									[docId]: {
// 										status: DocStatus.PROCESSING,
// 										updated_at: new Date().toISOString(),
// 										content: statusDoc.content,
// 										content_summary: statusDoc.content_summary,
// 										content_length: statusDoc.content_length,
// 										created_at: statusDoc.created_at,
// 									},
// 								});

// 								// Process everything in parallel
// 								await Promise.all([
// 									this.chunksVdb.upsert(chunks),
// 									this._processEntityRelationGraph(
// 										chunks,
// 										pipelineStatus,
// 										pipelineStatusLock,
// 									),
// 									this.fullDocs.upsert({
// 										[docId]: { content: statusDoc.content },
// 									}),
// 									this.textChunks.upsert(chunks),
// 								]);

// 								// Update document status to PROCESSED
// 								await this.docStatus.upsert({
// 									[docId]: {
// 										status: DocStatus.PROCESSED,
// 										chunks_count: Object.keys(chunks).length,
// 										content: statusDoc.content,
// 										content_summary: statusDoc.content_summary,
// 										content_length: statusDoc.content_length,
// 										created_at: statusDoc.created_at,
// 										updated_at: new Date().toISOString(),
// 									},
// 								});
// 							} catch (e) {
// 								// Log error and update pipeline status
// 								const error = e as Error;
// 								const errorMsg = `Failed to process document ${docId}: ${error.message}`;
// 								logger.error(errorMsg);
// 								pipelineStatus.latest_message = errorMsg;
// 								pipelineStatus.history_messages.push(errorMsg);

// 								// Update document status to failed
// 								await this.docStatus.upsert({
// 									[docId]: {
// 										status: DocStatus.FAILED,
// 										error: error.message,
// 										content: statusDoc.content,
// 										content_summary: statusDoc.content_summary,
// 										content_length: statusDoc.content_length,
// 										created_at: statusDoc.created_at,
// 										updated_at: new Date().toISOString(),
// 									},
// 								});
// 								continue;
// 							}
// 						}

// 						const completionMessage = `Completed batch ${batchIdx + 1} of ${docsBatches.length}.`;
// 						logger.info(completionMessage);
// 						pipelineStatus.latest_message = completionMessage;
// 						pipelineStatus.history_messages.push(completionMessage);
// 					};

// 					batchPromises.push(
// 						processBatch(
// 							batchIdx,
// 							docsBatches[batchIdx],
// 							docsBatches.length,
// 						),
// 					);
// 				}

// 				await Promise.all(batchPromises);
// 				await this._insertDone();

// 				// Check if there's a pending request to process more documents
// 				let hasPendingRequest = false;

// 				// Update with lock
// 				await new Promise<void>((resolve) => {
// 					hasPendingRequest = !!pipelineStatus.request_pending;
// 					if (hasPendingRequest) {
// 						// Clear the request flag before checking for more documents
// 						pipelineStatus.request_pending = false;
// 					}
// 					resolve();
// 				});

// 				if (!hasPendingRequest) {
// 					break;
// 				}

// 				const logMessage =
// 					'Processing additional documents due to pending request';
// 				logger.info(logMessage);
// 				pipelineStatus.latest_message = logMessage;
// 				pipelineStatus.history_messages.push(logMessage);

// 				// Check for pending documents again
// 				const [processingDocs, failedDocs, pendingDocs] = await Promise.all([
// 					this.docStatus.getDocsByStatus(DocStatus.PROCESSING),
// 					this.docStatus.getDocsByStatus(DocStatus.FAILED),
// 					this.docStatus.getDocsByStatus(DocStatus.PENDING),
// 				]);

// 				toProcessDocs = {};
// 				Object.assign(
// 					toProcessDocs,
// 					processingDocs,
// 					failedDocs,
// 					pendingDocs,
// 				);
// 			}
// 		} finally {
// 			const logMessage = 'Document processing pipeline completed';
// 			logger.info(logMessage);

// 			// Reset busy status
// 			pipelineStatus.busy = false;
// 			pipelineStatus.latest_message = logMessage;
// 			pipelineStatus.history_messages.push(logMessage);
// 		}
// 	}

// 	/**
// 	 * Process entity and relation graph for a chunk
// 	 */
// 	async _processEntityRelationGraph(
// 		chunk: Record<string, any>,
// 		pipelineStatus: any = null,
// 		pipelineStatusLock: any = null,
// 	): Promise<void> {
// 		try {
// 			await extractEntities(
// 				chunk,
// 				this.chunkEntityRelationGraph,
// 				this.entitiesVdb,
// 				this.relationshipsVdb,
// 				this.getConfig(),
// 				pipelineStatus,
// 				pipelineStatusLock,
// 				this.llmResponseCache,
// 			);
// 		} catch (e) {
// 			logger.error('Failed to extract entities and relationships');
// 			throw e;
// 		}
// 	}

// 	/**
// 	 * Called when insert is complete to finalize the operation
// 	 */
// 	async _insertDone(
// 		pipelineStatus: any = null,
// 		pipelineStatusLock: any = null,
// 	): Promise<void> {
// 		const tasks: Promise<void>[] = [];

// 		for (const storage of [
// 			this.fullDocs,
// 			this.textChunks,
// 			this.llmResponseCache,
// 			this.entitiesVdb,
// 			this.relationshipsVdb,
// 			this.chunksVdb,
// 			this.chunkEntityRelationGraph,
// 		]) {
// 			if (storage) {
// 				tasks.push((storage as StorageNameSpace).indexDoneCallback());
// 			}
// 		}

// 		await Promise.all(tasks);

// 		const logMessage = 'All Insert done';
// 		logger.info(logMessage);

// 		if (pipelineStatus && pipelineStatusLock) {
// 			pipelineStatus.latest_message = logMessage;
// 			pipelineStatus.history_messages.push(logMessage);
// 		}
// 	}

// 	/**
// 	 * Insert a custom knowledge graph
// 	 */
// 	insertCustomKg(customKg: Record<string, any>, fullDocId?: string): void {
// 		this.ainsertCustomKg(customKg, fullDocId).catch((err) => {
// 			logger.error(`Error in insertCustomKg: ${err}`);
// 		});
// 	}

// 	/**
// 	 * Asynchronously insert a custom knowledge graph
// 	 */
// 	async ainsertCustomKg(
// 		customKg: Record<string, any>,
// 		fullDocId?: string,
// 	): Promise<void> {
// 		let updateStorage = false;
// 		try {
// 			// Insert chunks into vector storage
// 			const allChunksData: Record<string, Record<string, string>> = {};
// 			const chunkToSourceMap: Record<string, string> = {};

// 			// Process chunks
// 			if (customKg.chunks && Array.isArray(customKg.chunks)) {
// 				for (const chunkData of customKg.chunks) {
// 					const chunkContent = cleanText(chunkData.content);
// 					const sourceId = chunkData.source_id;
// 					const tokens = encodeStringByTiktoken(chunkContent, {
// 						modelName: this.tiktokenModelName,
// 					}).length;

// 					const chunkOrderIndex =
// 						'chunk_order_index' in chunkData
// 							? chunkData.chunk_order_index
// 							: 0;

// 					const chunkId = computeMdhashId(chunkContent, 'chunk-');

// 					const chunkEntry = {
// 						content: chunkContent,
// 						source_id: sourceId,
// 						tokens,
// 						chunk_order_index: chunkOrderIndex,
// 						full_doc_id: fullDocId || sourceId,
// 						status: DocStatus.PROCESSED,
// 					};

// 					allChunksData[chunkId] = chunkEntry;
// 					chunkToSourceMap[sourceId] = chunkId;
// 					updateStorage = true;
// 				}
// 			}

// 			// Insert chunks if any
// 			if (Object.keys(allChunksData).length > 0) {
// 				await Promise.all([
// 					this.chunksVdb.upsert(allChunksData),
// 					this.textChunks.upsert(allChunksData),
// 				]);
// 			}

// 			// Insert entities into knowledge graph
// 			const allEntitiesData: Array<Record<string, string>> = [];

// 			if (customKg.entities && Array.isArray(customKg.entities)) {
// 				for (const entityData of customKg.entities) {
// 					const entityName = entityData.entity_name;
// 					const entityType = entityData.entity_type || 'UNKNOWN';
// 					const description =
// 						entityData.description || 'No description provided';
// 					const sourceChunkId = entityData.source_id || 'UNKNOWN';
// 					const sourceId = chunkToSourceMap[sourceChunkId] || 'UNKNOWN';

// 					// Log if source_id is UNKNOWN
// 					if (sourceId === 'UNKNOWN') {
// 						logger.warning(
// 							`Entity '${entityName}' has an UNKNOWN source_id. Please check the source mapping.`,
// 						);
// 					}

// 					// Prepare node data
// 					const nodeData: Record<string, string> = {
// 						entity_id: entityName,
// 						entity_type: entityType,
// 						description,
// 						source_id: sourceId,
// 					};

// 					// Insert node data into the knowledge graph
// 					await this.chunkEntityRelationGraph.upsertNode(
// 						entityName,
// 						nodeData,
// 					);

// 					nodeData.entity_name = entityName;
// 					allEntitiesData.push(nodeData);
// 					updateStorage = true;
// 				}
// 			}

// 			// Insert relationships into knowledge graph
// 			const allRelationshipsData: Array<Record<string, any>> = [];

// 			if (customKg.relationships && Array.isArray(customKg.relationships)) {
// 				for (const relationshipData of customKg.relationships) {
// 					const srcId = relationshipData.src_id;
// 					const tgtId = relationshipData.tgt_id;
// 					const description = relationshipData.description;
// 					const keywords = relationshipData.keywords;
// 					const weight = relationshipData.weight || 1.0;
// 					const sourceChunkId = relationshipData.source_id || 'UNKNOWN';
// 					const sourceId = chunkToSourceMap[sourceChunkId] || 'UNKNOWN';

// 					// Log if source_id is UNKNOWN
// 					if (sourceId === 'UNKNOWN') {
// 						logger.warning(
// 							`Relationship from '${srcId}' to '${tgtId}' has an UNKNOWN source_id. Please check the source mapping.`,
// 						);
// 					}

// 					// Check if nodes exist in the knowledge graph
// 					for (const needInsertId of [srcId, tgtId]) {
// 						if (
// 							!(await this.chunkEntityRelationGraph.hasNode(
// 								needInsertId,
// 							))
// 						) {
// 							await this.chunkEntityRelationGraph.upsertNode(
// 								needInsertId,
// 								{
// 									entity_id: needInsertId,
// 									source_id: sourceId,
// 									description: 'UNKNOWN',
// 									entity_type: 'UNKNOWN',
// 								},
// 							);
// 						}
// 					}

// 					// Insert edge into the knowledge graph
// 					await this.chunkEntityRelationGraph.upsertEdge(srcId, tgtId, {
// 						weight,
// 						description,
// 						keywords,
// 						source_id: sourceId,
// 					});

// 					const edgeData: Record<string, any> = {
// 						src_id: srcId,
// 						tgt_id: tgtId,
// 						description,
// 						keywords,
// 						source_id: sourceId,
// 						weight,
// 					};

// 					allRelationshipsData.push(edgeData);
// 					updateStorage = true;
// 				}
// 			}

// 			// Insert entities into vector storage with consistent format
// 			if (allEntitiesData.length > 0) {
// 				const dataForVdb: Record<string, any> = {};

// 				for (const dp of allEntitiesData) {
// 					const id = computeMdhashId(dp.entity_name, 'ent-');
// 					dataForVdb[id] = {
// 						content: `${dp.entity_name}\n${dp.description}`,
// 						entity_name: dp.entity_name,
// 						source_id: dp.source_id,
// 						description: dp.description,
// 						entity_type: dp.entity_type,
// 					};
// 				}

// 				await this.entitiesVdb.upsert(dataForVdb);
// 			}

// 			// Insert relationships into vector storage with consistent format
// 			if (allRelationshipsData.length > 0) {
// 				const dataForVdb: Record<string, any> = {};

// 				for (const dp of allRelationshipsData) {
// 					const id = computeMdhashId(dp.src_id + dp.tgt_id, 'rel-');
// 					dataForVdb[id] = {
// 						src_id: dp.src_id,
// 						tgt_id: dp.tgt_id,
// 						source_id: dp.source_id,
// 						content: `${dp.keywords}\t${dp.src_id}\n${dp.tgt_id}\n${dp.description}`,
// 						keywords: dp.keywords,
// 						description: dp.description,
// 						weight: dp.weight,
// 					};
// 				}

// 				await this.relationshipsVdb.upsert(dataForVdb);
// 			}
// 		} catch (e) {
// 			const error = e as Error;
// 			logger.error(`Error in ainsertCustomKg: ${error.message}`);
// 			throw e;
// 		} finally {
// 			if (updateStorage) {
// 				await this._insertDone();
// 			}
// 		}
// 	}

// 	/**
// 	 * Perform a sync query
// 	 */
// 	query(
// 		query: string,
// 		param: QueryParam = new QueryParam(),
// 		systemPrompt?: string,
// 	): string {
// 		let result: string = '';
// 		this.aquery(query, param, systemPrompt)
// 			.then((res) => {
// 				if (typeof res === 'string') {
// 					result = res;
// 				} else {
// 					// Handle async iterator result (not typical in sync path)
// 					logger.warning('Async iterator result in sync query');
// 					result =
// 						'Query returned an async iterator - use aquery for streaming results';
// 				}
// 			})
// 			.catch((err) => {
// 				logger.error(`Error in query: ${err}`);
// 				throw err;
// 			});

// 		return result;
// 	}

// 	/**
// 	 * Perform an async query
// 	 */
// 	async aquery(
// 		query: string,
// 		param: QueryParam = new QueryParam(),
// 		systemPrompt?: string,
// 	): Promise<string | AsyncIterableIterator<string>> {
// 		let response: string | AsyncIterableIterator<string>;

// 		query = query.trim();

// 		if (['local', 'global', 'hybrid'].includes(param.mode)) {
// 			response = await kgQuery(
// 				query,
// 				this.chunkEntityRelationGraph,
// 				this.entitiesVdb,
// 				this.relationshipsVdb,
// 				this.textChunks,
// 				param,
// 				this.getConfig(),
// 				this.llmResponseCache,
// 				systemPrompt,
// 			);
// 		} else if (param.mode === 'naive') {
// 			response = await naiveQuery(
// 				query,
// 				this.chunksVdb,
// 				this.textChunks,
// 				param,
// 				this.getConfig(),
// 				this.llmResponseCache,
// 				systemPrompt,
// 			);
// 		} else if (param.mode === 'mix') {
// 			response = await mixKgVectorQuery(
// 				query,
// 				this.chunkEntityRelationGraph,
// 				this.entitiesVdb,
// 				this.relationshipsVdb,
// 				this.chunksVdb,
// 				this.textChunks,
// 				param,
// 				this.getConfig(),
// 				this.llmResponseCache,
// 				systemPrompt,
// 			);
// 		} else {
// 			throw new Error(`Unknown mode ${param.mode}`);
// 		}

// 		await this._queryDone();
// 		return response;
// 	}

// 	/**
// 	 * Query with separate keyword extraction step
// 	 */
// 	queryWithSeparateKeywordExtraction(
// 		query: string,
// 		prompt: string,
// 		param: QueryParam = new QueryParam(),
// 	): string {
// 		let result: string = '';
// 		this.aqueryWithSeparateKeywordExtraction(query, prompt, param)
// 			.then((res) => {
// 				if (typeof res === 'string') {
// 					result = res;
// 				} else {
// 					// Handle async iterator result (not typical in sync path)
// 					logger.warning(
// 						'Async iterator result in sync query with keyword extraction',
// 					);
// 					result =
// 						'Query returned an async iterator - use aquery for streaming results';
// 				}
// 			})
// 			.catch((err) => {
// 				logger.error(`Error in query with keyword extraction: ${err}`);
// 				throw err;
// 			});

// 		return result;
// 	}

// 	/**
// 	 * Async version of query with separate keyword extraction
// 	 */
// 	async aqueryWithSeparateKeywordExtraction(
// 		query: string,
// 		prompt: string,
// 		param: QueryParam = new QueryParam(),
// 	): Promise<string | AsyncIterableIterator<string>> {
// 		const response = await queryWithKeywords(
// 			query,
// 			prompt,
// 			param,
// 			this.chunkEntityRelationGraph,
// 			this.entitiesVdb,
// 			this.relationshipsVdb,
// 			this.chunksVdb,
// 			this.textChunks,
// 			this.getConfig(),
// 			this.llmResponseCache,
// 		);

// 		await this._queryDone();
// 		return response;
// 	}

// 	/**
// 	 * Called when query is complete
// 	 */
// 	async _queryDone(): Promise<void> {
// 		await this.llmResponseCache.indexDoneCallback();
// 	}

// 	/**
// 	 * Delete an entity
// 	 */
// 	deleteByEntity(entityName: string): void {
// 		this.adeleteByEntity(entityName).catch((err) => {
// 			logger.error(`Error in deleteByEntity: ${err}`);
// 		});
// 	}

// 	/**
// 	 * Asynchronously delete an entity
// 	 */
// 	async adeleteByEntity(entityName: string): Promise<void> {
// 		try {
// 			await this.entitiesVdb.deleteEntity(entityName);
// 			await this.relationshipsVdb.deleteEntityRelation(entityName);
// 			await this.chunkEntityRelationGraph.deleteNode(entityName);

// 			logger.info(
// 				`Entity '${entityName}' and its relationships have been deleted.`,
// 			);
// 			await this._deleteByEntityDone();
// 		} catch (e) {
// 			const error = e as Error;
// 			logger.error(
// 				`Error while deleting entity '${entityName}': ${error.message}`,
// 			);
// 		}
// 	}

// 	/**
// 	 * Called when entity deletion is complete
// 	 */
// 	async _deleteByEntityDone(): Promise<void> {
// 		await Promise.all([
// 			(this.entitiesVdb as StorageNameSpace).indexDoneCallback(),
// 			(this.relationshipsVdb as StorageNameSpace).indexDoneCallback(),
// 			(this.chunkEntityRelationGraph as StorageNameSpace).indexDoneCallback(),
// 		]);
// 	}

// 	/**
// 	 * Delete a relation between two entities
// 	 */
// 	deleteByRelation(sourceEntity: string, targetEntity: string): void {
// 		this.adeleteByRelation(sourceEntity, targetEntity).catch((err) => {
// 			logger.error(`Error in deleteByRelation: ${err}`);
// 		});
// 	}

// 	/**
// 	 * Asynchronously delete a relation between two entities
// 	 */
// 	async adeleteByRelation(
// 		sourceEntity: string,
// 		targetEntity: string,
// 	): Promise<void> {
// 		try {
// 			// Check if the relation exists
// 			const edgeExists = await this.chunkEntityRelationGraph.hasEdge(
// 				sourceEntity,
// 				targetEntity,
// 			);

// 			if (!edgeExists) {
// 				logger.warning(
// 					`Relation from '${sourceEntity}' to '${targetEntity}' does not exist`,
// 				);
// 				return;
// 			}

// 			// Delete relation from vector database
// 			const relationId = computeMdhashId(sourceEntity + targetEntity, 'rel-');
// 			await this.relationshipsVdb.delete([relationId]);

// 			// Delete relation from knowledge graph
// 			await this.chunkEntityRelationGraph.removeEdges([
// 				[sourceEntity, targetEntity],
// 			]);

// 			logger.info(
// 				`Successfully deleted relation from '${sourceEntity}' to '${targetEntity}'`,
// 			);
// 			await this._deleteRelationDone();
// 		} catch (e) {
// 			const error = e as Error;
// 			logger.error(
// 				`Error while deleting relation from '${sourceEntity}' to '${targetEntity}': ${error.message}`,
// 			);
// 		}
// 	}

// 	/**
// 	 * Called when relation deletion is complete
// 	 */
// 	async _deleteRelationDone(): Promise<void> {
// 		await Promise.all([
// 			(this.relationshipsVdb as StorageNameSpace).indexDoneCallback(),
// 			(this.chunkEntityRelationGraph as StorageNameSpace).indexDoneCallback(),
// 		]);
// 	}

// 	/**
// 	 * Get current document processing status counts
// 	 */
// 	async getProcessingStatus(): Promise<Record<string, number>> {
// 		return this.docStatus.getStatusCounts();
// 	}

// 	/**
// 	 * Get documents by status
// 	 */
// 	async getDocsByStatus(
// 		status: DocStatus,
// 	): Promise<Record<string, DocProcessingStatus>> {
// 		return this.docStatus.getDocsByStatus(status);
// 	}

// 	/**
// 	 * Delete a document and all its related data
// 	 */
// 	async adeleteByDocId(docId: string): Promise<void> {
// 		try {
// 			// 1. Get the document status and related data
// 			const docStatus = await this.docStatus.getById(docId);
// 			if (!docStatus) {
// 				logger.warning(`Document ${docId} not found`);
// 				return;
// 			}

// 			logger.debug(`Starting deletion for document ${docId}`);

// 			// 2. Get all chunks related to this document
// 			const allChunks = await this.textChunks.getAll();
// 			const relatedChunks: Record<string, any> = {};

// 			for (const [chunkId, chunkData] of Object.entries(allChunks)) {
// 				if (
// 					typeof chunkData === 'object' &&
// 					chunkData &&
// 					chunkData.full_doc_id === docId
// 				) {
// 					relatedChunks[chunkId] = chunkData;
// 				}
// 			}

// 			if (Object.keys(relatedChunks).length === 0) {
// 				logger.warning(`No chunks found for document ${docId}`);
// 				return;
// 			}

// 			// Get all related chunk IDs
// 			const chunkIds = new Set(Object.keys(relatedChunks));
// 			logger.debug(`Found ${chunkIds.size} chunks to delete`);

// 			// 3. Check related entities and relationships before deleting
// 			for (const chunkId of chunkIds) {
// 				// Check entities
// 				const entitiesStorage = await this.entitiesVdb.clientStorage;
// 				const entities = entitiesStorage.data.filter(
// 					(dp: any) => dp.source_id && dp.source_id.includes(chunkId),
// 				);
// 				logger.debug(
// 					`Chunk ${chunkId} has ${entities.length} related entities`,
// 				);

// 				// Check relationships
// 				const relationshipsStorage =
// 					await this.relationshipsVdb.clientStorage;
// 				const relations = relationshipsStorage.data.filter(
// 					(dp: any) => dp.source_id && dp.source_id.includes(chunkId),
// 				);
// 				logger.debug(
// 					`Chunk ${chunkId} has ${relations.length} related relations`,
// 				);
// 			}

// 			// 4. Delete chunks from vector database
// 			if (chunkIds.size > 0) {
// 				await this.chunksVdb.delete(Array.from(chunkIds));
// 				await this.textChunks.delete(Array.from(chunkIds));
// 			}

// 			// 5. Find and process entities and relationships that have these chunks as source
// 			const entitiesToDelete = new Set<string>();
// 			const entitiesToUpdate: Record<string, string> = {};
// 			const relationshipsToDelete = new Set<[string, string]>();
// 			const relationshipsToUpdate: Record<string, string> = {};

// 			// Process entities
// 			const allLabels = await this.chunkEntityRelationGraph.getAllLabels();

// 			for (const nodeLabel of allLabels) {
// 				const nodeData =
// 					await this.chunkEntityRelationGraph.getNode(nodeLabel);

// 				if (nodeData && 'source_id' in nodeData) {
// 					// Split source_id using GRAPH_FIELD_SEP
// 					const sources = new Set(
// 						nodeData.source_id.split(GRAPH_FIELD_SEP),
// 					);

// 					// Remove chunk IDs that are being deleted
// 					for (const chunkId of chunkIds) {
// 						sources.delete(chunkId);
// 					}

// 					if (sources.size === 0) {
// 						entitiesToDelete.add(nodeLabel);
// 						logger.debug(
// 							`Entity ${nodeLabel} marked for deletion - no remaining sources`,
// 						);
// 					} else {
// 						const newSourceId =
// 							Array.from(sources).join(GRAPH_FIELD_SEP);
// 						entitiesToUpdate[nodeLabel] = newSourceId;
// 						logger.debug(
// 							`Entity ${nodeLabel} will be updated with new source_id: ${newSourceId}`,
// 						);
// 					}
// 				}
// 			}

// 			// Process relationships
// 			for (const nodeLabel of allLabels) {
// 				const nodeEdges =
// 					await this.chunkEntityRelationGraph.getNodeEdges(nodeLabel);

// 				if (nodeEdges && nodeEdges.length > 0) {
// 					for (const [src, tgt] of nodeEdges) {
// 						const edgeData = await this.chunkEntityRelationGraph.getEdge(
// 							src,
// 							tgt,
// 						);

// 						if (edgeData && 'source_id' in edgeData) {
// 							// Split source_id using GRAPH_FIELD_SEP
// 							const sources = new Set(
// 								edgeData.source_id.split(GRAPH_FIELD_SEP),
// 							);

// 							// Remove chunk IDs that are being deleted
// 							for (const chunkId of chunkIds) {
// 								sources.delete(chunkId);
// 							}

// 							if (sources.size === 0) {
// 								relationshipsToDelete.add([src, tgt]);
// 								logger.debug(
// 									`Relationship ${src}-${tgt} marked for deletion - no remaining sources`,
// 								);
// 							} else {
// 								const newSourceId =
// 									Array.from(sources).join(GRAPH_FIELD_SEP);
// 								relationshipsToUpdate[`${src}|${tgt}`] = newSourceId;
// 								logger.debug(
// 									`Relationship ${src}-${tgt} will be updated with new source_id: ${newSourceId}`,
// 								);
// 							}
// 						}
// 					}
// 				}
// 			}

// 			// Delete entities
// 			if (entitiesToDelete.size > 0) {
// 				for (const entity of entitiesToDelete) {
// 					await this.entitiesVdb.deleteEntity(entity);
// 					logger.debug(`Deleted entity ${entity} from vector DB`);
// 				}

// 				await this.chunkEntityRelationGraph.removeNodes(
// 					Array.from(entitiesToDelete),
// 				);
// 				logger.debug(`Deleted ${entitiesToDelete.size} entities from graph`);
// 			}

// 			// Update entities
// 			for (const [entity, newSourceId] of Object.entries(entitiesToUpdate)) {
// 				const nodeData = await this.chunkEntityRelationGraph.getNode(entity);

// 				if (nodeData) {
// 					nodeData.source_id = newSourceId;
// 					await this.chunkEntityRelationGraph.upsertNode(entity, nodeData);
// 					logger.debug(
// 						`Updated entity ${entity} with new source_id: ${newSourceId}`,
// 					);
// 				}
// 			}

// 			// Delete relationships
// 			if (relationshipsToDelete.size > 0) {
// 				for (const [src, tgt] of relationshipsToDelete) {
// 					const relId0 = computeMdhashId(src + tgt, 'rel-');
// 					const relId1 = computeMdhashId(tgt + src, 'rel-');
// 					await this.relationshipsVdb.delete([relId0, relId1]);
// 					logger.debug(
// 						`Deleted relationship ${src}-${tgt} from vector DB`,
// 					);
// 				}

// 				await this.chunkEntityRelationGraph.removeEdges(
// 					Array.from(relationshipsToDelete),
// 				);
// 				logger.debug(
// 					`Deleted ${relationshipsToDelete.size} relationships from graph`,
// 				);
// 			}

// 			// Update relationships
// 			for (const [key, newSourceId] of Object.entries(relationshipsToUpdate)) {
// 				const [src, tgt] = key.split('|');
// 				const edgeData = await this.chunkEntityRelationGraph.getEdge(
// 					src,
// 					tgt,
// 				);

// 				if (edgeData) {
// 					edgeData.source_id = newSourceId;
// 					await this.chunkEntityRelationGraph.upsertEdge(
// 						src,
// 						tgt,
// 						edgeData,
// 					);
// 					logger.debug(
// 						`Updated relationship ${src}-${tgt} with new source_id: ${newSourceId}`,
// 					);
// 				}
// 			}

// 			// 6. Delete original document and status
// 			await this.fullDocs.delete([docId]);
// 			await this.docStatus.delete([docId]);

// 			// 7. Ensure all indexes are updated
// 			await this._insertDone();

// 			logger.info(
// 				`Successfully deleted document ${docId} and related data. ` +
// 					`Deleted ${entitiesToDelete.size} entities and ${relationshipsToDelete.size} relationships. ` +
// 					`Updated ${Object.keys(entitiesToUpdate).length} entities and ` +
// 					`${Object.keys(relationshipsToUpdate).length} relationships.`,
// 			);

// 			// Add verification step
// 			await this.verifyDeletion(docId, Array.from(chunkIds));
// 		} catch (e) {
// 			const error = e as Error;
// 			logger.error(`Error while deleting document ${docId}: ${error.message}`);
// 		}
// 	}

// 	/**
// 	 * Verify that document and related data have been properly deleted
// 	 */
// 	private async verifyDeletion(docId: string, chunkIds: string[]): Promise<void> {
// 		// Verify if the document has been deleted
// 		if (await this.fullDocs.getById(docId)) {
// 			logger.warning(`Document ${docId} still exists in fullDocs`);
// 		}

// 		// Verify if chunks have been deleted
// 		const allRemainingChunks = await this.textChunks.getAll();
// 		const remainingRelatedChunks: Record<string, any> = {};

// 		for (const [chunkId, chunkData] of Object.entries(allRemainingChunks)) {
// 			if (
// 				typeof chunkData === 'object' &&
// 				chunkData &&
// 				chunkData.full_doc_id === docId
// 			) {
// 				remainingRelatedChunks[chunkId] = chunkData;
// 			}
// 		}

// 		if (Object.keys(remainingRelatedChunks).length > 0) {
// 			logger.warning(
// 				`Found ${Object.keys(remainingRelatedChunks).length} remaining chunks`,
// 			);
// 		}

// 		// Verify entities and relationships
// 		for (const chunkId of chunkIds) {
// 			await this.processDataVerification(
// 				'entities',
// 				this.entitiesVdb,
// 				chunkId,
// 			);
// 			await this.processDataVerification(
// 				'relationships',
// 				this.relationshipsVdb,
// 				chunkId,
// 			);
// 		}
// 	}

// 	/**
// 	 * Helper method for verifying and cleaning up data
// 	 */
// 	private async processDataVerification(
// 		dataType: string,
// 		vdb: BaseVectorStorage,
// 		chunkId: string,
// 	): Promise<void> {
// 		// Check data (entities or relationships)
// 		const storage = await vdb.clientStorage;
// 		const dataWithChunk = storage.data.filter((dp: any) => {
// 			return (
// 				dp.source_id && dp.source_id.split(GRAPH_FIELD_SEP).includes(chunkId)
// 			);
// 		});

// 		if (dataWithChunk.length > 0) {
// 			logger.warning(
// 				`Found ${dataWithChunk.length} ${dataType} still referencing chunk ${chunkId}`,
// 			);

// 			const dataForVdb: Record<string, any> = {};

// 			for (const item of dataWithChunk) {
// 				const oldSources = item.source_id.split(GRAPH_FIELD_SEP);
// 				const newSources = oldSources.filter((src) => src !== chunkId);

// 				if (newSources.length === 0) {
// 					logger.info(
// 						`${dataType} ${item.entity_name || 'N/A'} is deleted because source_id no longer exists`,
// 					);
// 					await vdb.deleteEntity(item);
// 				} else {
// 					item.source_id = newSources.join(GRAPH_FIELD_SEP);
// 					const itemId = item.__id__;
// 					dataForVdb[itemId] = { ...item };

// 					if (dataType === 'entities') {
// 						dataForVdb[itemId].content =
// 							dataForVdb[itemId].content ||
// 							`${item.entity_name || ''}${item.description || ''}`;
// 					} else {
// 						// relationships
// 						dataForVdb[itemId].content =
// 							dataForVdb[itemId].content ||
// 							`${item.keywords || ''}${item.src_id || ''}${item.tgt_id || ''}${item.description || ''}`;
// 					}
// 				}
// 			}

// 			if (Object.keys(dataForVdb).length > 0) {
// 				await vdb.upsert(dataForVdb);
// 				logger.info(`Successfully updated ${dataType} in vector DB`);
// 			}
// 		}
// 	}

// 	/**
// 	 * Get detailed information about an entity
// 	 */
// 	async getEntityInfo(
// 		entityName: string,
// 		includeVectorData: boolean = false,
// 	): Promise<Record<string, any>> {
// 		// Get information from the graph
// 		const nodeData = await this.chunkEntityRelationGraph.getNode(entityName);
// 		const sourceId = nodeData?.source_id;

// 		const result: Record<string, any> = {
// 			entity_name: entityName,
// 			source_id: sourceId,
// 			graph_data: nodeData,
// 		};

// 		// Optional: Get vector database information
// 		if (includeVectorData) {
// 			const entityId = computeMdhashId(entityName, 'ent-');
// 			const vectorData = await this.entitiesVdb.getById(entityId);
// 			result.vector_data = vectorData;
// 		}

// 		return result;
// 	}

// 	/**
// 	 * Get detailed information about a relationship
// 	 */
// 	async getRelationInfo(
// 		srcEntity: string,
// 		tgtEntity: string,
// 		includeVectorData: boolean = false,
// 	): Promise<Record<string, any>> {
// 		// Get information from the graph
// 		const edgeData = await this.chunkEntityRelationGraph.getEdge(
// 			srcEntity,
// 			tgtEntity,
// 		);
// 		const sourceId = edgeData?.source_id;

// 		const result: Record<string, any> = {
// 			src_entity: srcEntity,
// 			tgt_entity: tgtEntity,
// 			source_id: sourceId,
// 			graph_data: edgeData,
// 		};

// 		// Optional: Get vector database information
// 		if (includeVectorData) {
// 			const relId = computeMdhashId(srcEntity + tgtEntity, 'rel-');
// 			const vectorData = await this.relationshipsVdb.getById(relId);
// 			result.vector_data = vectorData;
// 		}

// 		return result;
// 	}

// 	/**
// 	 * Check if all required environment variables for storage implementation exist
// 	 */
// 	checkStorageEnvVars(storageName: string): void {
// 		const requiredVars = STORAGE_ENV_REQUIREMENTS[storageName] || [];
// 		const missingVars = requiredVars.filter((var_) => !(var_ in process.env));

// 		if (missingVars.length > 0) {
// 			throw new Error(
// 				`Storage implementation '${storageName}' requires the following ` +
// 					`environment variables: ${missingVars.join(', ')}`,
// 			);
// 		}
// 	}

// 	/**
// 	 * Clear cache data from the LLM response cache storage
// 	 */
// 	async aclearCache(modes?: string[]): Promise<void> {
// 		if (!this.llmResponseCache) {
// 			logger.warning('No cache storage configured');
// 			return;
// 		}

// 		const validModes = ['default', 'naive', 'local', 'global', 'hybrid', 'mix'];

// 		// Validate input
// 		if (modes && !modes.every((mode) => validModes.includes(mode))) {
// 			throw new Error(
// 				`Invalid mode. Valid modes are: ${validModes.join(', ')}`,
// 			);
// 		}

// 		try {
// 			// Reset the cache storage for specified mode
// 			if (modes) {
// 				await this.llmResponseCache.delete(modes);
// 				logger.info(`Cleared cache for modes: ${modes.join(', ')}`);
// 			} else {
// 				// Clear all modes
// 				await this.llmResponseCache.delete(validModes);
// 				logger.info('Cleared all cache');
// 			}

// 			await this.llmResponseCache.indexDoneCallback();
// 		} catch (e) {
// 			const error = e as Error;
// 			logger.error(`Error while clearing cache: ${error.message}`);
// 		}
// 	}

// 	/**
// 	 * Synchronous version of aclearCache
// 	 */
// 	clearCache(modes?: string[]): void {
// 		this.aclearCache(modes).catch((err) => {
// 			logger.error(`Error in clearCache: ${err}`);
// 		});
// 	}

// 	/**
// 	 * Asynchronously edit entity information
// 	 */
// 	async aeditEntity(
// 		entityName: string,
// 		updatedData: Record<string, string>,
// 		allowRename: boolean = true,
// 	): Promise<Record<string, any>> {
// 		try {
// 			// 1. Get current entity information
// 			const nodeExists =
// 				await this.chunkEntityRelationGraph.hasNode(entityName);

// 			if (!nodeExists) {
// 				throw new Error(`Entity '${entityName}' does not exist`);
// 			}

// 			const nodeData = await this.chunkEntityRelationGraph.getNode(entityName);

// 			// Check if entity is being renamed
// 			const newEntityName = updatedData.entity_name || entityName;
// 			const isRenaming = newEntityName !== entityName;

// 			// If renaming, check if new name already exists
// 			if (isRenaming) {
// 				if (!allowRename) {
// 					throw new Error(
// 						'Entity renaming is not allowed. Set allowRename=true to enable this feature',
// 					);
// 				}

// 				const existingNode =
// 					await this.chunkEntityRelationGraph.hasNode(newEntityName);

// 				if (existingNode) {
// 					throw new Error(
// 						`Entity name '${newEntityName}' already exists, cannot rename`,
// 					);
// 				}
// 			}

// 			// 2. Update entity information in the graph
// 			const newNodeData = { ...nodeData, ...updatedData };

// 			// Node data should not contain entity_name field
// 			if ('entity_name' in newNodeData) {
// 				delete newNodeData.entity_name;
// 			}

// 			// If renaming entity
// 			if (isRenaming) {
// 				logger.info(`Renaming entity '${entityName}' to '${newEntityName}'`);

// 				// Create new entity
// 				await this.chunkEntityRelationGraph.upsertNode(
// 					newEntityName,
// 					newNodeData,
// 				);

// 				// Store relationships that need to be updated
// 				const relationsToUpdate: Array<[string, string, any]> = [];

// 				// Get all edges related to the original entity
// 				const edges =
// 					await this.chunkEntityRelationGraph.getNodeEdges(entityName);

// 				if (edges && edges.length > 0) {
// 					// Recreate edges for the new entity
// 					for (const [source, target] of edges) {
// 						const edgeData = await this.chunkEntityRelationGraph.getEdge(
// 							source,
// 							target,
// 						);

// 						if (edgeData) {
// 							if (source === entityName) {
// 								await this.chunkEntityRelationGraph.upsertEdge(
// 									newEntityName,
// 									target,
// 									edgeData,
// 								);
// 								relationsToUpdate.push([
// 									newEntityName,
// 									target,
// 									edgeData,
// 								]);
// 							} else {
// 								// target === entityName
// 								await this.chunkEntityRelationGraph.upsertEdge(
// 									source,
// 									newEntityName,
// 									edgeData,
// 								);
// 								relationsToUpdate.push([
// 									source,
// 									newEntityName,
// 									edgeData,
// 								]);
// 							}
// 						}
// 					}
// 				}

// 				// Delete old entity
// 				await this.chunkEntityRelationGraph.deleteNode(entityName);

// 				// Delete old entity record from vector database
// 				const oldEntityId = computeMdhashId(entityName, 'ent-');
// 				await this.entitiesVdb.delete([oldEntityId]);

// 				logger.info(
// 					`Deleted old entity '${entityName}' and its vector embedding from database`,
// 				);

// 				// Update relationship vector representations
// 				for (const [src, tgt, edgeData] of relationsToUpdate) {
// 					const description = edgeData.description || '';
// 					const keywords = edgeData.keywords || '';
// 					const sourceId = edgeData.source_id || '';
// 					const weight = parseFloat(edgeData.weight || '1.0');

// 					// Create new content for embedding
// 					const content = `${src}\t${tgt}\n${keywords}\n${description}`;

// 					// Calculate relationship ID
// 					const relationId = computeMdhashId(src + tgt, 'rel-');

// 					// Prepare data for vector database update
// 					const relationData = {
// 						[relationId]: {
// 							content,
// 							src_id: src,
// 							tgt_id: tgt,
// 							source_id: sourceId,
// 							description,
// 							keywords,
// 							weight,
// 						},
// 					};

// 					// Update vector database
// 					await this.relationshipsVdb.upsert(relationData);
// 				}

// 				// Update working entity name to new name
// 				entityName = newEntityName;
// 			} else {
// 				// If not renaming, directly update node data
// 				await this.chunkEntityRelationGraph.upsertNode(
// 					entityName,
// 					newNodeData,
// 				);
// 			}

// 			// 3. Recalculate entity's vector representation and update vector database
// 			const description = newNodeData.description || '';
// 			const sourceId = newNodeData.source_id || '';
// 			const entityType = newNodeData.entity_type || '';
// 			const content = `${entityName}\n${description}`;

// 			// Calculate entity ID
// 			const entityId = computeMdhashId(entityName, 'ent-');

// 			// Prepare data for vector database update
// 			const entityData = {
// 				[entityId]: {
// 					content,
// 					entity_name: entityName,
// 					source_id: sourceId,
// 					description,
// 					entity_type: entityType,
// 				},
// 			};

// 			// Update vector database
// 			await this.entitiesVdb.upsert(entityData);

// 			// 4. Save changes
// 			await this._editEntityDone();

// 			logger.info(`Entity '${entityName}' successfully updated`);
// 			return this.getEntityInfo(entityName, true);
// 		} catch (e) {
// 			const error = e as Error;
// 			logger.error(
// 				`Error while editing entity '${entityName}': ${error.message}`,
// 			);
// 			throw e;
// 		}
// 	}

// 	/**
// 	 * Synchronously edit entity information
// 	 */
// 	editEntity(
// 		entityName: string,
// 		updatedData: Record<string, string>,
// 		allowRename: boolean = true,
// 	): Record<string, any> {
// 		let result: Record<string, any> = {};

// 		this.aeditEntity(entityName, updatedData, allowRename)
// 			.then((res) => {
// 				result = res;
// 			})
// 			.catch((err) => {
// 				logger.error(`Error in editEntity: ${err}`);
// 				throw err;
// 			});

// 		return result;
// 	}

// 	/**
// 	 * Callback after entity editing is complete
// 	 */
// 	async _editEntityDone(): Promise<void> {
// 		await Promise.all([
// 			(this.entitiesVdb as StorageNameSpace).indexDoneCallback(),
// 			(this.relationshipsVdb as StorageNameSpace).indexDoneCallback(),
// 			(this.chunkEntityRelationGraph as StorageNameSpace).indexDoneCallback(),
// 		]);
// 	}

// 	/**
// 	 * Asynchronously edit relation information
// 	 */
// 	async aeditRelation(
// 		sourceEntity: string,
// 		targetEntity: string,
// 		updatedData: Record<string, any>,
// 	): Promise<Record<string, any>> {
// 		try {
// 			// 1. Get current relation information
// 			const edgeExists = await this.chunkEntityRelationGraph.hasEdge(
// 				sourceEntity,
// 				targetEntity,
// 			);

// 			if (!edgeExists) {
// 				throw new Error(
// 					`Relation from '${sourceEntity}' to '${targetEntity}' does not exist`,
// 				);
// 			}

// 			const edgeData = await this.chunkEntityRelationGraph.getEdge(
// 				sourceEntity,
// 				targetEntity,
// 			);

// 			// Important: First delete the old relation record from the vector database
// 			const oldRelationId = computeMdhashId(
// 				sourceEntity + targetEntity,
// 				'rel-',
// 			);
// 			await this.relationshipsVdb.delete([oldRelationId]);

// 			logger.info(
// 				`Deleted old relation record from vector database for relation ${sourceEntity} -> ${targetEntity}`,
// 			);

// 			// 2. Update relation information in the graph
// 			const newEdgeData = { ...edgeData, ...updatedData };
// 			await this.chunkEntityRelationGraph.upsertEdge(
// 				sourceEntity,
// 				targetEntity,
// 				newEdgeData,
// 			);

// 			// 3. Recalculate relation's vector representation and update vector database
// 			const description = newEdgeData.description || '';
// 			const keywords = newEdgeData.keywords || '';
// 			const sourceId = newEdgeData.source_id || '';
// 			const weight = parseFloat(newEdgeData.weight || '1.0');

// 			// Create content for embedding
// 			const content = `${sourceEntity}\t${targetEntity}\n${keywords}\n${description}`;

// 			// Calculate relation ID
// 			const relationId = computeMdhashId(sourceEntity + targetEntity, 'rel-');

// 			// Prepare data for vector database update
// 			const relationData = {
// 				[relationId]: {
// 					content,
// 					src_id: sourceEntity,
// 					tgt_id: targetEntity,
// 					source_id: sourceId,
// 					description,
// 					keywords,
// 					weight,
// 				},
// 			};

// 			// Update vector database
// 			await this.relationshipsVdb.upsert(relationData);

// 			// 4. Save changes
// 			await this._editRelationDone();

// 			logger.info(
// 				`Relation from '${sourceEntity}' to '${targetEntity}' successfully updated`,
// 			);
// 			return this.getRelationInfo(sourceEntity, targetEntity, true);
// 		} catch (e) {
// 			const error = e as Error;
// 			logger.error(
// 				`Error while editing relation from '${sourceEntity}' to '${targetEntity}': ${error.message}`,
// 			);
// 			throw e;
// 		}
// 	}

// 	/**
// 	 * Synchronously edit relation information
// 	 */
// 	editRelation(
// 		sourceEntity: string,
// 		targetEntity: string,
// 		updatedData: Record<string, any>,
// 	): Record<string, any> {
// 		let result: Record<string, any> = {};

// 		this.aeditRelation(sourceEntity, targetEntity, updatedData)
// 			.then((res) => {
// 				result = res;
// 			})
// 			.catch((err) => {
// 				logger.error(`Error in editRelation: ${err}`);
// 				throw err;
// 			});

// 		return result;
// 	}

// 	/**
// 	 * Callback after relation editing is complete
// 	 */
// 	async _editRelationDone(): Promise<void> {
// 		await Promise.all([
// 			(this.relationshipsVdb as StorageNameSpace).indexDoneCallback(),
// 			(this.chunkEntityRelationGraph as StorageNameSpace).indexDoneCallback(),
// 		]);
// 	}

// 	/**
// 	 * Asynchronously create a new entity
// 	 */
// 	async acreateEntity(
// 		entityName: string,
// 		entityData: Record<string, any>,
// 	): Promise<Record<string, any>> {
// 		try {
// 			// Check if entity already exists
// 			const existingNode =
// 				await this.chunkEntityRelationGraph.hasNode(entityName);

// 			if (existingNode) {
// 				throw new Error(`Entity '${entityName}' already exists`);
// 			}

// 			// Prepare node data with defaults if missing
// 			const nodeData = {
// 				entity_id: entityName,
// 				entity_type: entityData.entity_type || 'UNKNOWN',
// 				description: entityData.description || '',
// 				source_id: entityData.source_id || 'manual',
// 			};

// 			// Add entity to knowledge graph
// 			await this.chunkEntityRelationGraph.upsertNode(entityName, nodeData);

// 			// Prepare content for entity
// 			const description = nodeData.description;
// 			const sourceId = nodeData.source_id;
// 			const entityType = nodeData.entity_type;
// 			const content = `${entityName}\n${description}`;

// 			// Calculate entity ID
// 			const entityId = computeMdhashId(entityName, 'ent-');

// 			// Prepare data for vector database update
// 			const entityDataForVdb = {
// 				[entityId]: {
// 					content,
// 					entity_name: entityName,
// 					source_id: sourceId,
// 					description,
// 					entity_type: entityType,
// 				},
// 			};

// 			// Update vector database
// 			await this.entitiesVdb.upsert(entityDataForVdb);

// 			// Save changes
// 			await this._editEntityDone();

// 			logger.info(`Entity '${entityName}' successfully created`);
// 			return this.getEntityInfo(entityName, true);
// 		} catch (e) {
// 			const error = e as Error;
// 			logger.error(
// 				`Error while creating entity '${entityName}': ${error.message}`,
// 			);
// 			throw e;
// 		}
// 	}

// 	/**
// 	 * Synchronously create a new entity
// 	 */
// 	createEntity(
// 		entityName: string,
// 		entityData: Record<string, any>,
// 	): Record<string, any> {
// 		let result: Record<string, any> = {};

// 		this.acreateEntity(entityName, entityData)
// 			.then((res) => {
// 				result = res;
// 			})
// 			.catch((err) => {
// 				logger.error(`Error in createEntity: ${err}`);
// 				throw err;
// 			});

// 		return result;
// 	}

// 	/**
// 	 * Asynchronously create a new relation between entities
// 	 */
// 	async acreateRelation(
// 		sourceEntity: string,
// 		targetEntity: string,
// 		relationData: Record<string, any>,
// 	): Promise<Record<string, any>> {
// 		try {
// 			// Check if both entities exist
// 			const sourceExists =
// 				await this.chunkEntityRelationGraph.hasNode(sourceEntity);
// 			const targetExists =
// 				await this.chunkEntityRelationGraph.hasNode(targetEntity);

// 			if (!sourceExists) {
// 				throw new Error(`Source entity '${sourceEntity}' does not exist`);
// 			}

// 			if (!targetExists) {
// 				throw new Error(`Target entity '${targetEntity}' does not exist`);
// 			}

// 			// Check if relation already exists
// 			const existingEdge = await this.chunkEntityRelationGraph.hasEdge(
// 				sourceEntity,
// 				targetEntity,
// 			);

// 			if (existingEdge) {
// 				throw new Error(
// 					`Relation from '${sourceEntity}' to '${targetEntity}' already exists`,
// 				);
// 			}

// 			// Prepare edge data with defaults if missing
// 			const edgeData = {
// 				description: relationData.description || '',
// 				keywords: relationData.keywords || '',
// 				source_id: relationData.source_id || 'manual',
// 				weight: parseFloat(relationData.weight || '1.0'),
// 			};

// 			// Add relation to knowledge graph
// 			await this.chunkEntityRelationGraph.upsertEdge(
// 				sourceEntity,
// 				targetEntity,
// 				edgeData,
// 			);

// 			// Prepare content for embedding
// 			const description = edgeData.description;
// 			const keywords = edgeData.keywords;
// 			const sourceId = edgeData.source_id;
// 			const weight = edgeData.weight;

// 			// Create content for embedding
// 			const content = `${keywords}\t${sourceEntity}\n${targetEntity}\n${description}`;

// 			// Calculate relation ID
// 			const relationId = computeMdhashId(sourceEntity + targetEntity, 'rel-');

// 			// Prepare data for vector database update
// 			const relationDataForVdb = {
// 				[relationId]: {
// 					content,
// 					src_id: sourceEntity,
// 					tgt_id: targetEntity,
// 					source_id: sourceId,
// 					description,
// 					keywords,
// 					weight,
// 				},
// 			};

// 			// Update vector database
// 			await this.relationshipsVdb.upsert(relationDataForVdb);

// 			// Save changes
// 			await this._editRelationDone();

// 			logger.info(
// 				`Relation from '${sourceEntity}' to '${targetEntity}' successfully created`,
// 			);
// 			return this.getRelationInfo(sourceEntity, targetEntity, true);
// 		} catch (e) {
// 			const error = e as Error;
// 			logger.error(
// 				`Error while creating relation from '${sourceEntity}' to '${targetEntity}': ${error.message}`,
// 			);
// 			throw e;
// 		}
// 	}

// 	/**
// 	 * Synchronously create a new relation between entities
// 	 */
// 	createRelation(
// 		sourceEntity: string,
// 		targetEntity: string,
// 		relationData: Record<string, any>,
// 	): Record<string, any> {
// 		let result: Record<string, any> = {};

// 		this.acreateRelation(sourceEntity, targetEntity, relationData)
// 			.then((res) => {
// 				result = res;
// 			})
// 			.catch((err) => {
// 				logger.error(`Error in createRelation: ${err}`);
// 				throw err;
// 			});

// 		return result;
// 	}

// 	/**
// 	 * Asynchronously merge multiple entities into one entity
// 	 */
// 	async amergeEntities(
// 		sourceEntities: string[],
// 		targetEntity: string,
// 		mergeStrategy?: Record<string, string>,
// 		targetEntityData?: Record<string, any>,
// 	): Promise<Record<string, any>> {
// 		try {
// 			// Default merge strategy
// 			const defaultStrategy = {
// 				description: 'concatenate',
// 				entity_type: 'keep_first',
// 				source_id: 'join_unique',
// 			};

// 			const finalMergeStrategy = mergeStrategy
// 				? { ...defaultStrategy, ...mergeStrategy }
// 				: defaultStrategy;

// 			const finalTargetEntityData = targetEntityData || {};

// 			// 1. Check if all source entities exist
// 			const sourceEntitiesData: Record<string, any> = {};

// 			for (const entityName of sourceEntities) {
// 				const nodeExists =
// 					await this.chunkEntityRelationGraph.hasNode(entityName);

// 				if (!nodeExists) {
// 					throw new Error(`Source entity '${entityName}' does not exist`);
// 				}

// 				const nodeData =
// 					await this.chunkEntityRelationGraph.getNode(entityName);
// 				sourceEntitiesData[entityName] = nodeData;
// 			}

// 			// 2. Check if target entity exists and get its data if it does
// 			const targetExists =
// 				await this.chunkEntityRelationGraph.hasNode(targetEntity);
// 			let existingTargetEntityData = {};

// 			if (targetExists) {
// 				existingTargetEntityData =
// 					await this.chunkEntityRelationGraph.getNode(targetEntity);
// 				logger.info(
// 					`Target entity '${targetEntity}' already exists, will merge data`,
// 				);
// 			}

// 			// 3. Merge entity data
// 			const sourceDataList = Object.values(sourceEntitiesData);
// 			if (targetExists) {
// 				sourceDataList.push(existingTargetEntityData);
// 			}

// 			const mergedEntityData = this._mergeEntityAttributes(
// 				sourceDataList,
// 				finalMergeStrategy,
// 			);

// 			// Apply any explicitly provided target entity data (overrides merged data)
// 			Object.assign(mergedEntityData, finalTargetEntityData);

// 			// 4. Get all relationships of the source entities
// 			const allRelations: Array<[string, string, string, any]> = [];

// 			for (const entityName of sourceEntities) {
// 				// Get all relationships where this entity is the source
// 				const outgoingEdges =
// 					await this.chunkEntityRelationGraph.getNodeEdges(entityName);

// 				if (outgoingEdges && outgoingEdges.length > 0) {
// 					for (const [src, tgt] of outgoingEdges) {
// 						// Ensure src is the current entity
// 						if (src === entityName) {
// 							const edgeData =
// 								await this.chunkEntityRelationGraph.getEdge(
// 									src,
// 									tgt,
// 								);
// 							allRelations.push(['outgoing', src, tgt, edgeData]);
// 						}
// 					}
// 				}

// 				// Get all relationships where this entity is the target
// 				const incomingEdges: Array<[string, string]> = [];
// 				const allLabels = await this.chunkEntityRelationGraph.getAllLabels();

// 				for (const label of allLabels) {
// 					if (label === entityName) {
// 						continue;
// 					}

// 					const nodeEdges =
// 						await this.chunkEntityRelationGraph.getNodeEdges(label);

// 					if (nodeEdges) {
// 						for (const [src, tgt] of nodeEdges) {
// 							if (tgt === entityName) {
// 								incomingEdges.push([src, tgt]);
// 							}
// 						}
// 					}
// 				}

// 				for (const [src, tgt] of incomingEdges) {
// 					const edgeData = await this.chunkEntityRelationGraph.getEdge(
// 						src,
// 						tgt,
// 					);
// 					allRelations.push(['incoming', src, tgt, edgeData]);
// 				}
// 			}

// 			// 5. Create or update the target entity
// 			if (!targetExists) {
// 				await this.chunkEntityRelationGraph.upsertNode(
// 					targetEntity,
// 					mergedEntityData,
// 				);
// 				logger.info(`Created new target entity '${targetEntity}'`);
// 			} else {
// 				await this.chunkEntityRelationGraph.upsertNode(
// 					targetEntity,
// 					mergedEntityData,
// 				);
// 				logger.info(`Updated existing target entity '${targetEntity}'`);
// 			}

// 			// 6. Recreate all relationships, pointing to the target entity
// 			const relationUpdates: Record<string, any> = {}; // Track relationships that need to be merged

// 			for (const [relType, src, tgt, edgeData] of allRelations) {
// 				const newSrc = sourceEntities.includes(src) ? targetEntity : src;
// 				const newTgt = sourceEntities.includes(tgt) ? targetEntity : tgt;

// 				// Skip relationships between source entities to avoid self-loops
// 				if (newSrc === newTgt) {
// 					logger.info(
// 						`Skipping relationship between source entities: ${src} -> ${tgt} to avoid self-loop`,
// 					);
// 					continue;
// 				}

// 				// Check if the same relationship already exists
// 				const relationKey = `${newSrc}|${newTgt}`;

// 				if (relationKey in relationUpdates) {
// 					// Merge relationship data
// 					const existingData = relationUpdates[relationKey].data;
// 					const mergedRelation = this._mergeRelationAttributes(
// 						[existingData, edgeData],
// 						{
// 							description: 'concatenate',
// 							keywords: 'join_unique',
// 							source_id: 'join_unique',
// 							weight: 'max',
// 						},
// 					);

// 					relationUpdates[relationKey].data = mergedRelation;
// 					logger.info(
// 						`Merged duplicate relationship: ${newSrc} -> ${newTgt}`,
// 					);
// 				} else {
// 					relationUpdates[relationKey] = {
// 						src: newSrc,
// 						tgt: newTgt,
// 						data: { ...edgeData },
// 					};
// 				}
// 			}

// 			// Apply relationship updates
// 			for (const relData of Object.values(relationUpdates)) {
// 				await this.chunkEntityRelationGraph.upsertEdge(
// 					relData.src,
// 					relData.tgt,
// 					relData.data,
// 				);

// 				logger.info(
// 					`Created or updated relationship: ${relData.src} -> ${relData.tgt}`,
// 				);
// 			}

// 			// 7. Update entity vector representation
// 			const description = mergedEntityData.description || '';
// 			const sourceId = mergedEntityData.source_id || '';
// 			const entityType = mergedEntityData.entity_type || '';
// 			const content = `${targetEntity}\n${description}`;

// 			const entityId = computeMdhashId(targetEntity, 'ent-');
// 			const entityDataForVdb = {
// 				[entityId]: {
// 					content,
// 					entity_name: targetEntity,
// 					source_id: sourceId,
// 					description,
// 					entity_type: entityType,
// 				},
// 			};

// 			await this.entitiesVdb.upsert(entityDataForVdb);

// 			// 8. Update relationship vector representations
// 			for (const relData of Object.values(relationUpdates)) {
// 				const src = relData.src;
// 				const tgt = relData.tgt;
// 				const edgeData = relData.data;

// 				const description = edgeData.description || '';
// 				const keywords = edgeData.keywords || '';
// 				const sourceId = edgeData.source_id || '';
// 				const weight = parseFloat(edgeData.weight || '1.0');

// 				const content = `${keywords}\t${src}\n${tgt}\n${description}`;
// 				const relationId = computeMdhashId(src + tgt, 'rel-');

// 				const relationDataForVdb = {
// 					[relationId]: {
// 						content,
// 						src_id: src,
// 						tgt_id: tgt,
// 						source_id: sourceId,
// 						description,
// 						keywords,
// 						weight,
// 					},
// 				};

// 				await this.relationshipsVdb.upsert(relationDataForVdb);
// 			}

// 			// 9. Delete source entities
// 			for (const entityName of sourceEntities) {
// 				if (entityName === targetEntity) {
// 					logger.info(
// 						`Skipping deletion of '${entityName}' as it's also the target entity`,
// 					);
// 					continue;
// 				}

// 				// Delete entity node from knowledge graph
// 				await this.chunkEntityRelationGraph.deleteNode(entityName);

// 				// Delete entity record from vector database
// 				const entityId = computeMdhashId(entityName, 'ent-');
// 				await this.entitiesVdb.delete([entityId]);

// 				// Also ensure any relationships specific to this entity are deleted from vector DB
// 				// This is a safety check, as these should have been transformed to the target entity already
// 				const entityRelationPrefix = computeMdhashId(entityName, 'rel-');
// 				const relationsWithEntity =
// 					await this.relationshipsVdb.searchByPrefix(entityRelationPrefix);

// 				if (relationsWithEntity && relationsWithEntity.length > 0) {
// 					const relationIds = relationsWithEntity.map((r) => r.id);
// 					await this.relationshipsVdb.delete(relationIds);
// 					logger.info(
// 						`Deleted ${relationIds.length} relation records for entity '${entityName}' from vector database`,
// 					);
// 				}

// 				logger.info(
// 					`Deleted source entity '${entityName}' and its vector embedding from database`,
// 				);
// 			}

// 			// 10. Save changes
// 			await this._mergeEntitiesDone();

// 			logger.info(
// 				`Successfully merged ${sourceEntities.length} entities into '${targetEntity}'`,
// 			);

// 			return this.getEntityInfo(targetEntity, true);
// 		} catch (e) {
// 			const error = e as Error;
// 			logger.error(`Error merging entities: ${error.message}`);
// 			throw e;
// 		}
// 	}

// 	/**
// 	 * Asynchronously exports all entities, relations, and relationships to various formats
// 	 */
// 	async aexportData(
// 		outputPath: string,
// 		fileFormat: 'csv' | 'excel' | 'md' | 'txt' = 'csv',
// 		includeVectorData: boolean = false,
// 	): Promise<void> {
// 		// Collect data
// 		const entitiesData: Array<Record<string, any>> = [];
// 		const relationsData: Array<Record<string, any>> = [];
// 		const relationshipsData: Array<Record<string, any>> = [];

// 		// --- Entities ---
// 		const allEntities = await this.chunkEntityRelationGraph.getAllLabels();

// 		for (const entityName of allEntities) {
// 			const entityInfo = await this.getEntityInfo(
// 				entityName,
// 				includeVectorData,
// 			);

// 			const entityRow: Record<string, any> = {
// 				entity_name: entityName,
// 				source_id: entityInfo.source_id,
// 				graph_data: JSON.stringify(entityInfo.graph_data),
// 			};

// 			if (includeVectorData && 'vector_data' in entityInfo) {
// 				entityRow.vector_data = JSON.stringify(entityInfo.vector_data);
// 			}

// 			entitiesData.push(entityRow);
// 		}

// 		// --- Relations ---
// 		for (const srcEntity of allEntities) {
// 			for (const tgtEntity of allEntities) {
// 				if (srcEntity === tgtEntity) {
// 					continue;
// 				}

// 				const edgeExists = await this.chunkEntityRelationGraph.hasEdge(
// 					srcEntity,
// 					tgtEntity,
// 				);

// 				if (edgeExists) {
// 					const relationInfo = await this.getRelationInfo(
// 						srcEntity,
// 						tgtEntity,
// 						includeVectorData,
// 					);

// 					const relationRow: Record<string, any> = {
// 						src_entity: srcEntity,
// 						tgt_entity: tgtEntity,
// 						source_id: relationInfo.source_id,
// 						graph_data: JSON.stringify(relationInfo.graph_data),
// 					};

// 					if (includeVectorData && 'vector_data' in relationInfo) {
// 						relationRow.vector_data = JSON.stringify(
// 							relationInfo.vector_data,
// 						);
// 					}

// 					relationsData.push(relationRow);
// 				}
// 			}
// 		}

// 		// --- Relationships (from VectorDB) ---
// 		const allRelationships = await this.relationshipsVdb.clientStorage;

// 		for (const rel of allRelationships.data) {
// 			relationshipsData.push({
// 				relationship_id: rel.__id__,
// 				data: JSON.stringify(rel),
// 			});
// 		}

// 		// Export based on format
// 		if (fileFormat === 'csv') {
// 			// CSV export
// 			const csvWriter = csvWrite({ headers: true });
// 			const writeStream = fs.createWriteStream(outputPath);

// 			// Write entities
// 			if (entitiesData.length > 0) {
// 				writeStream.write('# ENTITIES\n');
// 				csvWriter.pipe(writeStream);
// 				csvWriter.write(entitiesData);
// 				writeStream.write('\n\n');
// 			}

// 			// Write relations
// 			if (relationsData.length > 0) {
// 				writeStream.write('# RELATIONS\n');
// 				csvWriter.pipe(writeStream);
// 				csvWriter.write(relationsData);
// 				writeStream.write('\n\n');
// 			}

// 			// Write relationships
// 			if (relationshipsData.length > 0) {
// 				writeStream.write('# RELATIONSHIPS\n');
// 				csvWriter.pipe(writeStream);
// 				csvWriter.write(relationshipsData);
// 			}

// 			writeStream.end();
// 		} else if (fileFormat === 'excel') {
// 			// Excel export
// 			const workbook = new ExcelJS.Workbook();

// 			if (entitiesData.length > 0) {
// 				const worksheet = workbook.addWorksheet('Entities');
// 				const headers = Object.keys(entitiesData[0]);
// 				worksheet.columns = headers.map((header) => ({
// 					header,
// 					key: header,
// 				}));
// 				worksheet.addRows(entitiesData);
// 			}

// 			if (relationsData.length > 0) {
// 				const worksheet = workbook.addWorksheet('Relations');
// 				const headers = Object.keys(relationsData[0]);
// 				worksheet.columns = headers.map((header) => ({
// 					header,
// 					key: header,
// 				}));
// 				worksheet.addRows(relationsData);
// 			}

// 			if (relationshipsData.length > 0) {
// 				const worksheet = workbook.addWorksheet('Relationships');
// 				const headers = Object.keys(relationshipsData[0]);
// 				worksheet.columns = headers.map((header) => ({
// 					header,
// 					key: header,
// 				}));
// 				worksheet.addRows(relationshipsData);
// 			}

// 			await workbook.xlsx.writeFile(outputPath);
// 		} else if (fileFormat === 'md') {
// 			// Markdown export
// 			let mdContent = '# LightRAG Data Export\n\n';

// 			// Entities
// 			mdContent += '## Entities\n\n';

// 			if (entitiesData.length > 0) {
// 				// Write header
// 				mdContent +=
// 					'| ' + Object.keys(entitiesData[0]).join(' | ') + ' |\n';
// 				mdContent +=
// 					'| ' +
// 					Object.keys(entitiesData[0])
// 						.map(() => '---')
// 						.join(' | ') +
// 					' |\n';

// 				// Write rows
// 				for (const entity of entitiesData) {
// 					mdContent +=
// 						'| ' +
// 						Object.values(entity)
// 							.map((v) => String(v))
// 							.join(' | ') +
// 						' |\n';
// 				}

// 				mdContent += '\n\n';
// 			} else {
// 				mdContent += '*No entity data available*\n\n';
// 			}

// 			// Relations
// 			mdContent += '## Relations\n\n';

// 			if (relationsData.length > 0) {
// 				// Write header
// 				mdContent +=
// 					'| ' + Object.keys(relationsData[0]).join(' | ') + ' |\n';
// 				mdContent +=
// 					'| ' +
// 					Object.keys(relationsData[0])
// 						.map(() => '---')
// 						.join(' | ') +
// 					' |\n';

// 				// Write rows
// 				for (const relation of relationsData) {
// 					mdContent +=
// 						'| ' +
// 						Object.values(relation)
// 							.map((v) => String(v))
// 							.join(' | ') +
// 						' |\n';
// 				}

// 				mdContent += '\n\n';
// 			} else {
// 				mdContent += '*No relation data available*\n\n';
// 			}

// 			// Relationships
// 			mdContent += '## Relationships\n\n';

// 			if (relationshipsData.length > 0) {
// 				// Write header
// 				mdContent +=
// 					'| ' + Object.keys(relationshipsData[0]).join(' | ') + ' |\n';
// 				mdContent +=
// 					'| ' +
// 					Object.keys(relationshipsData[0])
// 						.map(() => '---')
// 						.join(' | ') +
// 					' |\n';

// 				// Write rows
// 				for (const relationship of relationshipsData) {
// 					mdContent +=
// 						'| ' +
// 						Object.values(relationship)
// 							.map((v) => String(v))
// 							.join(' | ') +
// 						' |\n';
// 				}
// 			} else {
// 				mdContent += '*No relationship data available*\n\n';
// 			}

// 			fs.writeFileSync(outputPath, mdContent, 'utf8');
// 		} else if (fileFormat === 'txt') {
// 			// Plain text export
// 			let txtContent = 'LIGHTRAG DATA EXPORT\n';
// 			txtContent += '='.repeat(80) + '\n\n';

// 			// Entities
// 			txtContent += 'ENTITIES\n';
// 			txtContent += '-'.repeat(80) + '\n';

// 			if (entitiesData.length > 0) {
// 				// Create fixed width columns
// 				const colWidths: Record<string, number> = {};

// 				for (const key of Object.keys(entitiesData[0])) {
// 					colWidths[key] = Math.max(
// 						key.length,
// 						...entitiesData.map((e) => String(e[key]).length),
// 					);
// 				}

// 				const header = Object.keys(entitiesData[0])
// 					.map((k) => k.padEnd(colWidths[k]))
// 					.join('  ');

// 				txtContent += header + '\n';
// 				txtContent += '-'.repeat(header.length) + '\n';

// 				// Write rows
// 				for (const entity of entitiesData) {
// 					const row = Object.entries(entity)
// 						.map(([k, v]) => String(v).padEnd(colWidths[k]))
// 						.join('  ');

// 					txtContent += row + '\n';
// 				}

// 				txtContent += '\n\n';
// 			} else {
// 				txtContent += 'No entity data available\n\n';
// 			}

// 			// Relations
// 			txtContent += 'RELATIONS\n';
// 			txtContent += '-'.repeat(80) + '\n';

// 			if (relationsData.length > 0) {
// 				// Create fixed width columns
// 				const colWidths: Record<string, number> = {};

// 				for (const key of Object.keys(relationsData[0])) {
// 					colWidths[key] = Math.max(
// 						key.length,
// 						...relationsData.map((r) => String(r[key]).length),
// 					);
// 				}

// 				const header = Object.keys(relationsData[0])
// 					.map((k) => k.padEnd(colWidths[k]))
// 					.join('  ');

// 				txtContent += header + '\n';
// 				txtContent += '-'.repeat(header.length) + '\n';

// 				// Write rows
// 				for (const relation of relationsData) {
// 					const row = Object.entries(relation)
// 						.map(([k, v]) => String(v).padEnd(colWidths[k]))
// 						.join('  ');

// 					txtContent += row + '\n';
// 				}

// 				txtContent += '\n\n';
// 			} else {
// 				txtContent += 'No relation data available\n\n';
// 			}

// 			// Relationships
// 			txtContent += 'RELATIONSHIPS\n';
// 			txtContent += '-'.repeat(80) + '\n';

// 			if (relationshipsData.length > 0) {
// 				// Create fixed width columns
// 				const colWidths: Record<string, number> = {};

// 				for (const key of Object.keys(relationshipsData[0])) {
// 					colWidths[key] = Math.max(
// 						key.length,
// 						...relationshipsData.map((r) => String(r[key]).length),
// 					);
// 				}

// 				const header = Object.keys(relationshipsData[0])
// 					.map((k) => k.padEnd(colWidths[k]))
// 					.join('  ');

// 				txtContent += header + '\n';
// 				txtContent += '-'.repeat(header.length) + '\n';

// 				// Write rows
// 				for (const relationship of relationshipsData) {
// 					const row = Object.entries(relationship)
// 						.map(([k, v]) => String(v).padEnd(colWidths[k]))
// 						.join('  ');

// 					txtContent += row + '\n';
// 				}
// 			} else {
// 				txtContent += 'No relationship data available\n\n';
// 			}

// 			fs.writeFileSync(outputPath, txtContent, 'utf8');
// 		} else {
// 			throw new Error(
// 				`Unsupported file format: ${fileFormat}. ` +
// 					`Choose from: csv, excel, md, txt`,
// 			);
// 		}

// 		if (fileFormat) {
// 			console.log(
// 				`Data exported to: ${outputPath} with format: ${fileFormat}`,
// 			);
// 		} else {
// 			console.log('Data displayed as table format');
// 		}
// 	}

// 	/**
// 	 * Synchronously exports all entities, relations, and relationships to various formats
// 	 */
// 	exportData(
// 		outputPath: string,
// 		fileFormat: 'csv' | 'excel' | 'md' | 'txt' = 'csv',
// 		includeVectorData: boolean = false,
// 	): void {
// 		this.aexportData(outputPath, fileFormat, includeVectorData).catch((err) => {
// 			logger.error(`Error in exportData: ${err}`);
// 		});
// 	}

// 	/**
// 	 * Synchronously merge multiple entities into one entity
// 	 */
// 	mergeEntities(
// 		sourceEntities: string[],
// 		targetEntity: string,
// 		mergeStrategy?: Record<string, string>,
// 		targetEntityData?: Record<string, any>,
// 	): Record<string, any> {
// 		let result: Record<string, any> = {};

// 		this.amergeEntities(
// 			sourceEntities,
// 			targetEntity,
// 			mergeStrategy,
// 			targetEntityData,
// 		)
// 			.then((res) => {
// 				result = res;
// 			})
// 			.catch((err) => {
// 				logger.error(`Error in mergeEntities: ${err}`);
// 				throw err;
// 			});

// 		return result;
// 	}

// 	/**
// 	 * Merge attributes from multiple entities
// 	 */
// 	private _mergeEntityAttributes(
// 		entityDataList: Array<Record<string, any>>,
// 		mergeStrategy: Record<string, string>,
// 	): Record<string, any> {
// 		const mergedData: Record<string, any> = {};

// 		// Collect all possible keys
// 		const allKeys = new Set<string>();

// 		for (const data of entityDataList) {
// 			Object.keys(data).forEach((key) => allKeys.add(key));
// 		}

// 		// Merge values for each key
// 		for (const key of allKeys) {
// 			// Get all values for this key
// 			const values = entityDataList
// 				.map((data) => data[key])
// 				.filter((value) => value !== undefined && value !== null);

// 			if (values.length === 0) {
// 				continue;
// 			}

// 			// Merge values according to strategy
// 			const strategy = mergeStrategy[key] || 'keep_first';

// 			if (strategy === 'concatenate') {
// 				mergedData[key] = values.join('\n\n');
// 			} else if (strategy === 'keep_first') {
// 				mergedData[key] = values[0];
// 			} else if (strategy === 'keep_last') {
// 				mergedData[key] = values[values.length - 1];
// 			} else if (strategy === 'join_unique') {
// 				// Handle fields separated by GRAPH_FIELD_SEP
// 				const uniqueItems = new Set<string>();

// 				for (const value of values) {
// 					const items = value.split(GRAPH_FIELD_SEP);
// 					items.forEach((item) => uniqueItems.add(item));
// 				}

// 				mergedData[key] = Array.from(uniqueItems).join(GRAPH_FIELD_SEP);
// 			} else {
// 				// Default strategy
// 				mergedData[key] = values[0];
// 			}
// 		}

// 		return mergedData;
// 	}

// 	/**
// 	 * Merge attributes from multiple relationships
// 	 */
// 	private _mergeRelationAttributes(
// 		relationDataList: Array<Record<string, any>>,
// 		mergeStrategy: Record<string, string>,
// 	): Record<string, any> {
// 		const mergedData: Record<string, any> = {};

// 		// Collect all possible keys
// 		const allKeys = new Set<string>();

// 		for (const data of relationDataList) {
// 			Object.keys(data).forEach((key) => allKeys.add(key));
// 		}

// 		// Merge values for each key
// 		for (const key of allKeys) {
// 			// Get all values for this key
// 			const values = relationDataList
// 				.map((data) => data[key])
// 				.filter((value) => value !== undefined && value !== null);

// 			if (values.length === 0) {
// 				continue;
// 			}

// 			// Merge values according to strategy
// 			const strategy = mergeStrategy[key] || 'keep_first';

// 			if (strategy === 'concatenate') {
// 				mergedData[key] = values.map((v) => String(v)).join('\n\n');
// 			} else if (strategy === 'keep_first') {
// 				mergedData[key] = values[0];
// 			} else if (strategy === 'keep_last') {
// 				mergedData[key] = values[values.length - 1];
// 			} else if (strategy === 'join_unique') {
// 				// Handle fields separated by GRAPH_FIELD_SEP
// 				const uniqueItems = new Set<string>();

// 				for (const value of values) {
// 					const items = String(value).split(GRAPH_FIELD_SEP);
// 					items.forEach((item) => uniqueItems.add(item));
// 				}

// 				mergedData[key] = Array.from(uniqueItems).join(GRAPH_FIELD_SEP);
// 			} else if (strategy === 'max') {
// 				// For numeric fields like weight
// 				try {
// 					mergedData[key] = Math.max(
// 						...values.map((v) => parseFloat(String(v))),
// 					);
// 				} catch (e) {
// 					mergedData[key] = values[0];
// 				}
// 			} else {
// 				// Default strategy
// 				mergedData[key] = values[0];
// 			}
// 		}

// 		return mergedData;
// 	}

// 	/**
// 	 * Callback after entity merging is complete
// 	 */
// 	async _mergeEntitiesDone(): Promise<void> {
// 		await Promise.all([
// 			(this.entitiesVdb as StorageNameSpace).indexDoneCallback(),
// 			(this.relationshipsVdb as StorageNameSpace).indexDoneCallback(),
// 			(this.chunkEntityRelationGraph as StorageNameSpace).indexDoneCallback(),
// 		]);
// 	}
// }
