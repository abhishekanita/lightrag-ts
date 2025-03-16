import {
	cleanStr,
	computeMdHashId,
	decodeTokensByTiktoken,
	encodeStringByTiktoken,
	isFloatRegex,
	listOfListToCsv,
	packUserAssToOpenaiMessages,
	splitStringByMultiMarkers,
	truncateListByTokenSize,
	computeArgsHash,
	handleCache,
	CacheData,
	verboseDebug,
} from './utils';

import {
	BaseGraphStorage,
	BaseKVStorage,
	BaseVectorStorage,
	TextChunkSchema,
	QueryParam,
} from './base';

import { GRAPH_FIELD_SEP, PROMPTS } from './prompt';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ override: true });

interface ChunkData {
	tokens: number;
	content: string;
	chunk_order_index: number;
}

interface GlobalConfig {
	llm_model_func: CallableFunction;
	llm_model_max_token_size: number;
	tiktoken_model_name: string;
	entity_summary_to_max_tokens: number;
	addon_params: Record<string, any>;
	entity_extract_max_gleaning: number;
	enable_llm_cache_for_entity_extract: boolean;
}

interface PipelineStatus {
	latest_message: string;
	history_messages: string[];
}

export function chunkingByTokenSize(
	content: string,
	splitByCharacter: string | null = null,
	splitByCharacterOnly: boolean = false,
	overlapTokenSize: number = 128,
	maxTokenSize: number = 1024,
	tiktokenModel: string = 'gpt-4o',
): ChunkData[] {
	const tokens = encodeStringByTiktoken(content, tiktokenModel);
	const results: ChunkData[] = [];

	if (splitByCharacter) {
		const rawChunks = content.split(splitByCharacter);
		const newChunks: [number, string][] = [];

		if (splitByCharacterOnly) {
			for (const chunk of rawChunks) {
				const _tokens = encodeStringByTiktoken(chunk, tiktokenModel);
				newChunks.push([_tokens.length, chunk]);
			}
		} else {
			for (const chunk of rawChunks) {
				const _tokens = encodeStringByTiktoken(chunk, tiktokenModel);
				if (_tokens.length > maxTokenSize) {
					for (
						let start = 0;
						start < _tokens.length;
						start += maxTokenSize - overlapTokenSize
					) {
						const chunkContent = decodeTokensByTiktoken(
							_tokens.slice(start, start + maxTokenSize),
							tiktokenModel,
						);
						newChunks.push([
							Math.min(maxTokenSize, _tokens.length - start),
							chunkContent,
						]);
					}
				} else {
					newChunks.push([_tokens.length, chunk]);
				}
			}
		}

		for (let index = 0; index < newChunks.length; index++) {
			const [_len, chunk] = newChunks[index];
			results.push({
				tokens: _len,
				content: chunk.trim(),
				chunk_order_index: index,
			});
		}
	} else {
		for (
			let index = 0, start = 0;
			start < tokens.length;
			index++, start += maxTokenSize - overlapTokenSize
		) {
			const chunkContent = decodeTokensByTiktoken(
				tokens.slice(start, start + maxTokenSize),
				tiktokenModel,
			);
			results.push({
				tokens: Math.min(maxTokenSize, tokens.length - start),
				content: chunkContent.trim(),
				chunk_order_index: index,
			});
		}
	}

	return results;
}

async function _handleEntityRelationSummary(
	entityOrRelationName: string,
	description: string,
	globalConfig: GlobalConfig,
): Promise<string> {
	const useLlmFunc: CallableFunction = globalConfig.llm_model_func;
	const llmMaxTokens = globalConfig.llm_model_max_token_size;
	const tiktokenModelName = globalConfig.tiktoken_model_name;
	const summaryMaxTokens = globalConfig.entity_summary_to_max_tokens;
	const language = globalConfig.addon_params.language || PROMPTS.DEFAULT_LANGUAGE;

	const tokens = encodeStringByTiktoken(description, tiktokenModelName);
	if (tokens.length < summaryMaxTokens) {
		// No need for summary
		return description;
	}

	const promptTemplate = PROMPTS.summarize_entity_descriptions;
	const useDescription = decodeTokensByTiktoken(
		tokens.slice(0, llmMaxTokens),
		tiktokenModelName,
	);

	const contextBase = {
		entity_name: entityOrRelationName,
		description_list: useDescription.split(GRAPH_FIELD_SEP),
		language,
	};

	const usePrompt = promptTemplate.format(contextBase);
	logger.debug(`Trigger summary: ${entityOrRelationName}`);
	const summary = await useLlmFunc(usePrompt, { max_tokens: summaryMaxTokens });
	return summary;
}

async function _handleSingleEntityExtraction(
	recordAttributes: string[],
	chunkKey: string,
): Promise<Record<string, any> | null> {
	if (recordAttributes.length < 4 || recordAttributes[0] !== '"entity"') {
		return null;
	}

	// Clean and validate entity name
	const entityName = cleanStr(recordAttributes[1]).replace(/^"|"$/g, '');
	if (!entityName.trim()) {
		logger.warning(
			`Entity extraction error: empty entity name in: ${recordAttributes}`,
		);
		return null;
	}

	// Clean and validate entity type
	const entityType = cleanStr(recordAttributes[2]).replace(/^"|"$/g, '');
	if (!entityType.trim() || entityType.startsWith('("')) {
		logger.warning(
			`Entity extraction error: invalid entity type in: ${recordAttributes}`,
		);
		return null;
	}

	// Clean and validate description
	const entityDescription = cleanStr(recordAttributes[3]).replace(/^"|"$/g, '');
	if (!entityDescription.trim()) {
		logger.warning(
			`Entity extraction error: empty description for entity '${entityName}' of type '${entityType}'`,
		);
		return null;
	}

	return {
		entity_name: entityName,
		entity_type: entityType,
		description: entityDescription,
		source_id: chunkKey,
		metadata: { created_at: Date.now() / 1000 },
	};
}

async function _handleSingleRelationshipExtraction(
	recordAttributes: string[],
	chunkKey: string,
): Promise<Record<string, any> | null> {
	if (recordAttributes.length < 5 || recordAttributes[0] !== '"relationship"') {
		return null;
	}

	// Add this record as edge
	const source = cleanStr(recordAttributes[1]).replace(/^"|"$/g, '');
	const target = cleanStr(recordAttributes[2]).replace(/^"|"$/g, '');
	const edgeDescription = cleanStr(recordAttributes[3]).replace(/^"|"$/g, '');
	const edgeKeywords = cleanStr(recordAttributes[4]).replace(/^"|"$/g, '');
	const edgeSourceId = chunkKey;

	const weight = isFloatRegex(recordAttributes[recordAttributes.length - 1])
		? parseFloat(
				recordAttributes[recordAttributes.length - 1].replace(/^"|"$/g, ''),
			)
		: 1.0;

	return {
		src_id: source,
		tgt_id: target,
		weight,
		description: edgeDescription,
		keywords: edgeKeywords,
		source_id: edgeSourceId,
		metadata: { created_at: Date.now() / 1000 },
	};
}

async function _mergeNodesThenUpsert(
	entityName: string,
	nodesData: Record<string, any>[],
	knowledgeGraphInst: BaseGraphStorage,
	globalConfig: GlobalConfig,
): Promise<Record<string, any>> {
	const alreadyEntityTypes: string[] = [];
	const alreadySourceIds: string[] = [];
	const alreadyDescription: string[] = [];

	const alreadyNode = await knowledgeGraphInst.getNode(entityName);
	if (alreadyNode !== null) {
		alreadyEntityTypes.push(alreadyNode.entity_type);
		alreadySourceIds.push(
			...splitStringByMultiMarkers(alreadyNode.source_id, [GRAPH_FIELD_SEP]),
		);
		alreadyDescription.push(alreadyNode.description);
	}

	// Count occurrence of each entity type
	const entityTypeCounter = new Counter();
	[...nodesData.map((dp) => dp.entity_type), ...alreadyEntityTypes].forEach(
		(type) => {
			entityTypeCounter.add(type);
		},
	);

	// Sort by count (descending) and take the most common
	const entityType = [...entityTypeCounter.entries()].sort(
		(a, b) => b[1] - a[1],
	)[0][0];

	// Join descriptions
	let description = [
		...new Set([
			...nodesData.map((dp) => dp.description),
			...alreadyDescription,
		]),
	]
		.sort()
		.join(GRAPH_FIELD_SEP);

	// Join source IDs
	const sourceId = [
		...new Set([...nodesData.map((dp) => dp.source_id), ...alreadySourceIds]),
	].join(GRAPH_FIELD_SEP);

	description = await _handleEntityRelationSummary(
		entityName,
		description,
		globalConfig,
	);

	const nodeData = {
		entity_id: entityName,
		entity_type: entityType,
		description,
		source_id: sourceId,
	};

	await knowledgeGraphInst.upsertNode(entityName, nodeData);

	return {
		...nodeData,
		entity_name: entityName,
	};
}

async function _mergeEdgesThenUpsert(
	srcId: string,
	tgtId: string,
	edgesData: Record<string, any>[],
	knowledgeGraphInst: BaseGraphStorage,
	globalConfig: GlobalConfig,
): Promise<Record<string, any>> {
	const alreadyWeights: number[] = [];
	const alreadySourceIds: string[] = [];
	const alreadyDescription: string[] = [];
	const alreadyKeywords: string[] = [];

	if (await knowledgeGraphInst.hasEdge(srcId, tgtId)) {
		const alreadyEdge = await knowledgeGraphInst.getEdge(srcId, tgtId);

		// Handle the case where getEdge returns null or missing fields
		if (alreadyEdge) {
			// Get weight with default 0.0 if missing
			alreadyWeights.push(alreadyEdge.weight || 0.0);

			// Get source_id and split if it exists
			if (
				alreadyEdge.source_id !== null &&
				alreadyEdge.source_id !== undefined
			) {
				alreadySourceIds.push(
					...splitStringByMultiMarkers(alreadyEdge.source_id, [
						GRAPH_FIELD_SEP,
					]),
				);
			}

			// Get description if it exists
			if (
				alreadyEdge.description !== null &&
				alreadyEdge.description !== undefined
			) {
				alreadyDescription.push(alreadyEdge.description);
			}

			// Get keywords if they exist and split
			if (
				alreadyEdge.keywords !== null &&
				alreadyEdge.keywords !== undefined
			) {
				alreadyKeywords.push(
					...splitStringByMultiMarkers(alreadyEdge.keywords, [
						GRAPH_FIELD_SEP,
					]),
				);
			}
		}
	}

	// Process edges_data with null checks
	const weight = [...edgesData.map((dp) => dp.weight), ...alreadyWeights].reduce(
		(sum, w) => sum + w,
		0,
	);

	const description = [
		...new Set([
			...edgesData.filter((dp) => dp.description).map((dp) => dp.description),
			...alreadyDescription,
		]),
	]
		.sort()
		.join(GRAPH_FIELD_SEP);

	const keywords = [
		...new Set([
			...edgesData.filter((dp) => dp.keywords).map((dp) => dp.keywords),
			...alreadyKeywords,
		]),
	]
		.sort()
		.join(GRAPH_FIELD_SEP);

	const sourceId = [
		...new Set([
			...edgesData.filter((dp) => dp.source_id).map((dp) => dp.source_id),
			...alreadySourceIds,
		]),
	].join(GRAPH_FIELD_SEP);

	// Ensure nodes exist before creating edge
	for (const needInsertId of [srcId, tgtId]) {
		if (!(await knowledgeGraphInst.hasNode(needInsertId))) {
			await knowledgeGraphInst.upsertNode(needInsertId, {
				entity_id: needInsertId,
				source_id: sourceId,
				description,
				entity_type: 'UNKNOWN',
			});
		}
	}

	const processedDescription = await _handleEntityRelationSummary(
		`(${srcId}, ${tgtId})`,
		description,
		globalConfig,
	);

	await knowledgeGraphInst.upsertEdge(srcId, tgtId, {
		weight,
		description: processedDescription,
		keywords,
		source_id: sourceId,
	});

	return {
		src_id: srcId,
		tgt_id: tgtId,
		description: processedDescription,
		keywords,
		source_id: sourceId,
	};
}

export async function extractEntities(
	chunks: Record<string, TextChunkSchema>,
	knowledgeGraphInst: BaseGraphStorage,
	entityVdb: BaseVectorStorage,
	relationshipsVdb: BaseVectorStorage,
	globalConfig: GlobalConfig,
	pipelineStatus: PipelineStatus | null = null,
	pipelineStatusLock: any = null,
	llmResponseCache: BaseKVStorage | null = null,
): Promise<void> {
	const useLlmFunc: CallableFunction = globalConfig.llm_model_func;
	const entityExtractMaxGleaning = globalConfig.entity_extract_max_gleaning;
	const enableLlmCacheForEntityExtract: boolean =
		globalConfig.enable_llm_cache_for_entity_extract;

	const orderedChunks = Object.entries(chunks);

	// Add language and example number params to prompt
	const language = globalConfig.addon_params.language || PROMPTS.DEFAULT_LANGUAGE;
	const entityTypes =
		globalConfig.addon_params.entity_types || PROMPTS.DEFAULT_ENTITY_TYPES;
	const exampleNumber = globalConfig.addon_params.example_number;

	let examples: string;
	if (exampleNumber && exampleNumber < PROMPTS.entity_extraction_examples.length) {
		examples = PROMPTS.entity_extraction_examples
			.slice(0, exampleNumber)
			.join('\n');
	} else {
		examples = PROMPTS.entity_extraction_examples.join('\n');
	}

	const exampleContextBase = {
		tuple_delimiter: PROMPTS.DEFAULT_TUPLE_DELIMITER,
		record_delimiter: PROMPTS.DEFAULT_RECORD_DELIMITER,
		completion_delimiter: PROMPTS.DEFAULT_COMPLETION_DELIMITER,
		entity_types: entityTypes.join(', '),
		language,
	};

	// Format examples
	examples = examples.format(exampleContextBase);

	const entityExtractPrompt = PROMPTS.entity_extraction;
	const contextBase = {
		tuple_delimiter: PROMPTS.DEFAULT_TUPLE_DELIMITER,
		record_delimiter: PROMPTS.DEFAULT_RECORD_DELIMITER,
		completion_delimiter: PROMPTS.DEFAULT_COMPLETION_DELIMITER,
		entity_types: entityTypes.join(','),
		examples,
		language,
	};

	const continuePrompt = PROMPTS.entity_continue_extraction;
	const ifLoopPrompt = PROMPTS.entity_if_loop_extraction;

	let processedChunks = 0;
	const totalChunks = orderedChunks.length;

	async function _userLlmFuncWithCache(
		inputText: string,
		historyMessages: Record<string, string>[] = null,
	): Promise<string> {
		if (enableLlmCacheForEntityExtract && llmResponseCache) {
			let _prompt: string;

			if (historyMessages) {
				const history = JSON.stringify(historyMessages);
				_prompt = `${history}\n${inputText}`;
			} else {
				_prompt = inputText;
			}

			// TODO: add cache_type="extract"
			const argHash = computeArgsHash(_prompt);
			const [cachedReturn, , ,] = await handleCache(
				llmResponseCache,
				argHash,
				_prompt,
				'default',
				'extract',
			);

			if (cachedReturn) {
				logger.debug(`Found cache for ${argHash}`);
				statisticData.llm_cache += 1;
				return cachedReturn;
			}

			statisticData.llm_call += 1;
			let res: string;

			if (historyMessages) {
				res = await useLlmFunc(inputText, {
					history_messages: historyMessages,
				});
			} else {
				res = await useLlmFunc(inputText);
			}

			await saveToCache(llmResponseCache, {
				args_hash: argHash,
				content: res,
				prompt: _prompt,
				cache_type: 'extract',
			} as CacheData);

			return res;
		}

		if (historyMessages) {
			return await useLlmFunc(inputText, {
				history_messages: historyMessages,
			});
		} else {
			return await useLlmFunc(inputText);
		}
	}

	async function _processExtractionResult(result: string, chunkKey: string) {
		const maybeNodes: DefaultDict<string, any[]> = new DefaultDict(Array);
		const maybeEdges: DefaultDict<string, any[]> = new DefaultDict(Array);

		const records = splitStringByMultiMarkers(result, [
			contextBase.record_delimiter,
			contextBase.completion_delimiter,
		]);

		for (const record of records) {
			const match = record.match(/\((.*)\)/);
			if (!match) continue;

			const recordContent = match[1];
			const recordAttributes = splitStringByMultiMarkers(recordContent, [
				contextBase.tuple_delimiter,
			]);

			const ifEntities = await _handleSingleEntityExtraction(
				recordAttributes,
				chunkKey,
			);
			if (ifEntities !== null) {
				maybeNodes.get(ifEntities.entity_name).push(ifEntities);
				continue;
			}

			const ifRelation = await _handleSingleRelationshipExtraction(
				recordAttributes,
				chunkKey,
			);
			if (ifRelation !== null) {
				const key = `${ifRelation.src_id}:${ifRelation.tgt_id}`;
				maybeEdges.get(key).push(ifRelation);
			}
		}

		return [Object.fromEntries(maybeNodes), Object.fromEntries(maybeEdges)];
	}

	async function _processSingleContent(chunkKeyDp: [string, TextChunkSchema]) {
		const chunkKey = chunkKeyDp[0];
		const chunkDp = chunkKeyDp[1];
		const content = chunkDp.content;

		// Get initial extraction
		const hintPrompt = entityExtractPrompt
			.format({ ...contextBase, input_text: '{input_text}' })
			.format({ ...contextBase, input_text: content });

		const finalResult = await _userLlmFuncWithCache(hintPrompt);
		let history = packUserAssToOpenaiMessages(hintPrompt, finalResult);

		// Process initial extraction
		const [maybeNodes, maybeEdges] = await _processExtractionResult(
			finalResult,
			chunkKey,
		);

		// Process additional gleaning results
		for (
			let nowGleanIndex = 0;
			nowGleanIndex < entityExtractMaxGleaning;
			nowGleanIndex++
		) {
			const gleanResult = await _userLlmFuncWithCache(continuePrompt, history);
			history = [
				...history,
				...packUserAssToOpenaiMessages(continuePrompt, gleanResult),
			];

			// Process gleaning result separately
			const [gleanNodes, gleanEdges] = await _processExtractionResult(
				gleanResult,
				chunkKey,
			);

			// Merge results
			for (const [entityName, entities] of Object.entries(gleanNodes)) {
				if (!maybeNodes[entityName]) {
					maybeNodes[entityName] = [];
				}
				maybeNodes[entityName].push(...entities);
			}

			for (const [edgeKey, edges] of Object.entries(gleanEdges)) {
				if (!maybeEdges[edgeKey]) {
					maybeEdges[edgeKey] = [];
				}
				maybeEdges[edgeKey].push(...edges);
			}

			if (nowGleanIndex === entityExtractMaxGleaning - 1) {
				break;
			}

			const ifLoopResult: string = await _userLlmFuncWithCache(
				ifLoopPrompt,
				history,
			);
			const cleanedResult = ifLoopResult
				.trim()
				.replace(/^["']|["']$/g, '')
				.toLowerCase();
			if (cleanedResult !== 'yes') {
				break;
			}
		}

		processedChunks += 1;
		const entitiesCount = Object.keys(maybeNodes).length;
		const relationsCount = Object.keys(maybeEdges).length;
		const logMessage = `  Chunk ${processedChunks}/${totalChunks}: extracted ${entitiesCount} entities and ${relationsCount} relationships (deduplicated)`;

		logger.info(logMessage);
		if (pipelineStatus !== null && pipelineStatusLock !== null) {
			await pipelineStatusLock.acquire();
			try {
				pipelineStatus.latest_message = logMessage;
				pipelineStatus.history_messages.push(logMessage);
			} finally {
				pipelineStatusLock.release();
			}
		}

		return [maybeNodes, maybeEdges];
	}

	// Process all chunks in parallel
	const taskPromises = orderedChunks.map((c) => _processSingleContent(c));
	const results = await Promise.all(taskPromises);

	// Combine all results
	const maybeNodes: DefaultDict<string, any[]> = new DefaultDict(Array);
	const maybeEdges: DefaultDict<string, any[]> = new DefaultDict(Array);

	for (const [mNodes, mEdges] of results) {
		for (const [k, v] of Object.entries(mNodes)) {
			maybeNodes.get(k).push(...v);
		}

		for (const [k, v] of Object.entries(mEdges)) {
			const [src, tgt] = k.split(':');
			const sortedKey = [src, tgt].sort().join(':');
			maybeEdges.get(sortedKey).push(...v);
		}
	}

	// Import required lock mechanism (this would need implementation in TypeScript)
	async function getGraphDbLock(enableLogging = false) {
		// Implement appropriate locking mechanism for TypeScript
		// This is a placeholder - you'd need to implement actual locking
		return {
			acquire: async () => {},
			release: () => {},
		};
	}

	const graphDbLock = await getGraphDbLock(false);

	// Ensure that nodes and edges are merged and upserted atomically
	await graphDbLock.acquire();
	try {
		// Process nodes
		const nodePromises = Object.entries(maybeNodes).map(([k, v]) =>
			_mergeNodesThenUpsert(k, v, knowledgeGraphInst, globalConfig),
		);
		const allEntitiesData = await Promise.all(nodePromises);

		// Process edges
		const edgePromises = Object.entries(maybeEdges).map(([k, v]) => {
			const [src, tgt] = k.split(':');
			return _mergeEdgesThenUpsert(
				src,
				tgt,
				v,
				knowledgeGraphInst,
				globalConfig,
			);
		});
		const allRelationshipsData = await Promise.all(edgePromises);

		// Handle empty results
		if (!allEntitiesData.length && !allRelationshipsData.length) {
			const logMessage = "Didn't extract any entities and relationships.";
			logger.info(logMessage);
			if (pipelineStatus !== null && pipelineStatusLock !== null) {
				await pipelineStatusLock.acquire();
				try {
					pipelineStatus.latest_message = logMessage;
					pipelineStatus.history_messages.push(logMessage);
				} finally {
					pipelineStatusLock.release();
				}
			}
			return;
		}

		if (!allEntitiesData.length) {
			const logMessage = "Didn't extract any entities";
			logger.info(logMessage);
			if (pipelineStatus !== null && pipelineStatusLock !== null) {
				await pipelineStatusLock.acquire();
				try {
					pipelineStatus.latest_message = logMessage;
					pipelineStatus.history_messages.push(logMessage);
				} finally {
					pipelineStatusLock.release();
				}
			}
		}

		if (!allRelationshipsData.length) {
			const logMessage = "Didn't extract any relationships";
			logger.info(logMessage);
			if (pipelineStatus !== null && pipelineStatusLock !== null) {
				await pipelineStatusLock.acquire();
				try {
					pipelineStatus.latest_message = logMessage;
					pipelineStatus.history_messages.push(logMessage);
				} finally {
					pipelineStatusLock.release();
				}
			}
		}

		const logMessage = `Extracted ${allEntitiesData.length} entities and ${allRelationshipsData.length} relationships (deduplicated)`;
		logger.info(logMessage);
		if (pipelineStatus !== null && pipelineStatusLock !== null) {
			await pipelineStatusLock.acquire();
			try {
				pipelineStatus.latest_message = logMessage;
				pipelineStatus.history_messages.push(logMessage);
			} finally {
				pipelineStatusLock.release();
			}
		}

		verboseDebug(`New entities: ${JSON.stringify(allEntitiesData)}`);
		verboseDebug(`New relationships: ${JSON.stringify(allRelationshipsData)}`);

		// Insert entities to VDB
		if (entityVdb !== null && allEntitiesData.length > 0) {
			const dataForVdb: Record<string, any> = {};

			for (const dp of allEntitiesData) {
				const id = computeMdHashId(dp.entity_name, 'ent-');
				dataForVdb[id] = {
					entity_name: dp.entity_name,
					entity_type: dp.entity_type,
					content: `${dp.entity_name}\n${dp.description}`,
					source_id: dp.source_id,
					metadata: {
						created_at: dp.metadata?.created_at || Date.now() / 1000,
					},
				};
			}

			await entityVdb.upsert(dataForVdb);
		}

		// Insert relationships to VDB
		if (relationshipsVdb !== null && allRelationshipsData.length > 0) {
			const dataForVdb: Record<string, any> = {};

			for (const dp of allRelationshipsData) {
				const id = computeMdHashId(dp.src_id + dp.tgt_id, 'rel-');
				dataForVdb[id] = {
					src_id: dp.src_id,
					tgt_id: dp.tgt_id,
					keywords: dp.keywords,
					content: `${dp.src_id}\t${dp.tgt_id}\n${dp.keywords}\n${dp.description}`,
					source_id: dp.source_id,
					metadata: {
						created_at: dp.metadata?.created_at || Date.now() / 1000,
					},
				};
			}

			await relationshipsVdb.upsert(dataForVdb);
		}
	} finally {
		graphDbLock.release();
	}
}

export async function kgQuery(
	query: string,
	knowledgeGraphInst: BaseGraphStorage,
	entitiesVdb: BaseVectorStorage,
	relationshipsVdb: BaseVectorStorage,
	textChunksDb: BaseKVStorage,
	queryParam: QueryParam,
	globalConfig: Record<string, any>,
	hashingKv: BaseKVStorage | null = null,
	systemPrompt: string | null = null,
): Promise<string | AsyncIterator<string>> {
	// Handle cache
	const useModelFunc = globalConfig.llm_model_func;
	const argsHash = computeArgsHash(queryParam.mode, query, 'query');
	const [cachedResponse, quantized, minVal, maxVal] = await handleCache(
		hashingKv,
		argsHash,
		query,
		queryParam.mode,
		'query',
	);

	if (cachedResponse !== null) {
		return cachedResponse;
	}

	// Extract keywords using extract_keywords_only function which already supports conversation history
	const [hlKeywords, llKeywords] = await extractKeywordsOnly(
		query,
		queryParam,
		globalConfig,
		hashingKv,
	);

	logger.debug(`High-level keywords: ${hlKeywords}`);
	logger.debug(`Low-level keywords: ${llKeywords}`);

	// Handle empty keywords
	if (hlKeywords.length === 0 && llKeywords.length === 0) {
		logger.warning('low_level_keywords and high_level_keywords is empty');
		return PROMPTS.fail_response;
	}

	if (llKeywords.length === 0 && ['local', 'hybrid'].includes(queryParam.mode)) {
		logger.warning(
			`low_level_keywords is empty, switching from ${queryParam.mode} mode to global mode`,
		);
		queryParam.mode = 'global';
	}

	if (hlKeywords.length === 0 && ['global', 'hybrid'].includes(queryParam.mode)) {
		logger.warning(
			`high_level_keywords is empty, switching from ${queryParam.mode} mode to local mode`,
		);
		queryParam.mode = 'local';
	}

	const llKeywordsStr = llKeywords.length ? llKeywords.join(', ') : '';
	const hlKeywordsStr = hlKeywords.length ? hlKeywords.join(', ') : '';

	// Build context
	const context = await _buildQueryContext(
		llKeywordsStr,
		hlKeywordsStr,
		knowledgeGraphInst,
		entitiesVdb,
		relationshipsVdb,
		textChunksDb,
		queryParam,
	);

	if (queryParam.only_need_context) {
		return context;
	}

	if (context === null) {
		return PROMPTS.fail_response;
	}

	// Process conversation history
	let historyContext = '';
	if (queryParam.conversation_history) {
		historyContext = getConversationTurns(
			queryParam.conversation_history,
			queryParam.history_turns,
		);
	}

	const sysPromptTemp = systemPrompt || PROMPTS.rag_response;
	const sysPrompt = sysPromptTemp.format({
		context_data: context,
		response_type: queryParam.response_type,
		history: historyContext,
	});

	if (queryParam.only_need_prompt) {
		return sysPrompt;
	}

	const lenOfPrompts = encodeStringByTiktoken(query + sysPrompt).length;
	logger.debug(`[kg_query]Prompt Tokens: ${lenOfPrompts}`);

	const response = await useModelFunc(query, {
		system_prompt: sysPrompt,
		stream: queryParam.stream,
	});

	let processedResponse = response;
	if (typeof response === 'string' && response.length > sysPrompt.length) {
		processedResponse = response
			.replace(sysPrompt, '')
			.replace('user', '')
			.replace('model', '')
			.replace(query, '')
			.replace('<system>', '')
			.replace('</system>', '')
			.trim();
	}

	// Save to cache
	await saveToCache(hashingKv, {
		args_hash: argsHash,
		content: processedResponse,
		prompt: query,
		quantized,
		min_val: minVal,
		max_val: maxVal,
		mode: queryParam.mode,
		cache_type: 'query',
	} as CacheData);

	return processedResponse;
}

export async function extractKeywordsOnly(
	text: string,
	param: QueryParam,
	globalConfig: Record<string, any>,
	hashingKv: BaseKVStorage | null = null,
): Promise<[string[], string[]]> {
	// 1. Handle cache if needed - add cache type for keywords
	const argsHash = computeArgsHash(param.mode, text, 'keywords');
	const [cachedResponse, quantized, minVal, maxVal] = await handleCache(
		hashingKv,
		argsHash,
		text,
		param.mode,
		'keywords',
	);

	if (cachedResponse !== null) {
		try {
			const keywordsData = JSON.parse(cachedResponse);
			return [
				keywordsData.high_level_keywords,
				keywordsData.low_level_keywords,
			];
		} catch (e) {
			logger.warning(
				'Invalid cache format for keywords, proceeding with extraction',
			);
		}
	}

	// 2. Build the examples
	const exampleNumber = globalConfig.addon_params?.example_number;
	let examples: string;
	if (
		exampleNumber &&
		exampleNumber < PROMPTS.keywords_extraction_examples.length
	) {
		examples = PROMPTS.keywords_extraction_examples
			.slice(0, exampleNumber)
			.join('\n');
	} else {
		examples = PROMPTS.keywords_extraction_examples.join('\n');
	}

	const language = globalConfig.addon_params?.language || PROMPTS.DEFAULT_LANGUAGE;

	// 3. Process conversation history
	let historyContext = '';
	if (param.conversation_history) {
		historyContext = getConversationTurns(
			param.conversation_history,
			param.history_turns,
		);
	}

	// 4. Build the keyword-extraction prompt
	const kwPrompt = PROMPTS.keywords_extraction.format({
		query: text,
		examples,
		language,
		history: historyContext,
	});

	const lenOfPrompts = encodeStringByTiktoken(kwPrompt).length;
	logger.debug(`[kg_query]Prompt Tokens: ${lenOfPrompts}`);

	// 5. Call the LLM for keyword extraction
	const useModelFunc = globalConfig.llm_model_func;
	const result = await useModelFunc(kwPrompt, { keyword_extraction: true });

	// 6. Parse out JSON from the LLM response
	const match = result.match(/\{.*\}/s);
	if (!match) {
		logger.error('No JSON-like structure found in the LLM respond.');
		return [[], []];
	}

	try {
		const keywordsData = JSON.parse(match[0]);
		const hlKeywords = keywordsData.high_level_keywords || [];
		const llKeywords = keywordsData.low_level_keywords || [];

		// 7. Cache only the processed keywords with cache type
		if (hlKeywords.length || llKeywords.length) {
			const cacheData = {
				high_level_keywords: hlKeywords,
				low_level_keywords: llKeywords,
			};

			await saveToCache(hashingKv, {
				args_hash: argsHash,
				content: JSON.stringify(cacheData),
				prompt: text,
				quantized,
				min_val: minVal,
				max_val: maxVal,
				mode: param.mode,
				cache_type: 'keywords',
			} as CacheData);
		}

		return [hlKeywords, llKeywords];
	} catch (e) {
		logger.error(`JSON parsing error: ${e}`);
		return [[], []];
	}
}

export async function mixKgVectorQuery(
	query: string,
	knowledgeGraphInst: BaseGraphStorage,
	entitiesVdb: BaseVectorStorage,
	relationshipsVdb: BaseVectorStorage,
	chunksVdb: BaseVectorStorage,
	textChunksDb: BaseKVStorage,
	queryParam: QueryParam,
	globalConfig: Record<string, any>,
	hashingKv: BaseKVStorage | null = null,
	systemPrompt: string | null = null,
): Promise<string | AsyncIterator<string>> {
	// 1. Cache handling
	const useModelFunc = globalConfig.llm_model_func;
	const argsHash = computeArgsHash('mix', query, 'query');
	const [cachedResponse, quantized, minVal, maxVal] = await handleCache(
		hashingKv,
		argsHash,
		query,
		'mix',
		'query',
	);

	if (cachedResponse !== null) {
		return cachedResponse;
	}

	// Process conversation history
	let historyContext = '';
	if (queryParam.conversation_history) {
		historyContext = getConversationTurns(
			queryParam.conversation_history,
			queryParam.history_turns,
		);
	}

	// 2. Execute knowledge graph and vector searches in parallel
	async function getKgContext() {
		try {
			// Extract keywords using extract_keywords_only function which already supports conversation history
			const [hlKeywords, llKeywords] = await extractKeywordsOnly(
				query,
				queryParam,
				globalConfig,
				hashingKv,
			);

			if (!hlKeywords.length && !llKeywords.length) {
				logger.warning('Both high-level and low-level keywords are empty');
				return null;
			}

			// Convert keyword lists to strings
			const llKeywordsStr = llKeywords.length ? llKeywords.join(', ') : '';
			const hlKeywordsStr = hlKeywords.length ? hlKeywords.join(', ') : '';

			// Set query mode based on available keywords
			if (!llKeywordsStr && !hlKeywordsStr) {
				return null;
			} else if (!llKeywordsStr) {
				queryParam.mode = 'global';
			} else if (!hlKeywordsStr) {
				queryParam.mode = 'local';
			} else {
				queryParam.mode = 'hybrid';
			}

			// Build knowledge graph context
			const context = await _buildQueryContext(
				llKeywordsStr,
				hlKeywordsStr,
				knowledgeGraphInst,
				entitiesVdb,
				relationshipsVdb,
				textChunksDb,
				queryParam,
			);

			return context;
		} catch (e) {
			logger.error(`Error in getKgContext: ${e}`);
			return null;
		}
	}

	async function getVectorContext() {
		// Consider conversation history in vector search
		const augmentedQuery = historyContext
			? `${historyContext}\n${query}`
			: query;

		try {
			// Reduce top_k for vector search in hybrid mode since we have structured information from KG
			const mixTopk = Math.min(10, queryParam.top_k);

			// TODO: add ids to the query
			const results = await chunksVdb.query(
				augmentedQuery,
				mixTopk,
				queryParam.ids,
			);

			if (!results || results.length === 0) {
				return null;
			}

			const chunksIds = results.map((r) => r.id);
			const chunks = await textChunksDb.getByIds(chunksIds);

			const validChunks = [];
			for (let i = 0; i < chunks.length; i++) {
				const chunk = chunks[i];
				const result = results[i];

				if (chunk !== null && chunk.content) {
					// Merge chunk content and time metadata
					validChunks.push({
						content: chunk.content,
						created_at: result.created_at || null,
					});
				}
			}

			if (validChunks.length === 0) {
				return null;
			}

			const maybeTrunChunks = truncateListByTokenSize(
				validChunks,
				(x) => x.content,
				queryParam.max_token_for_text_unit,
			);

			if (maybeTrunChunks.length === 0) {
				return null;
			}

			// Include time information in content
			const formattedChunks = [];
			for (const c of maybeTrunChunks) {
				let chunkText = c.content;
				if (c.created_at) {
					const date = new Date(c.created_at * 1000);
					chunkText = `[Created at: ${date.toISOString().replace('T', ' ').substr(0, 19)}]\n${chunkText}`;
				}
				formattedChunks.push(chunkText);
			}

			logger.debug(
				`Truncate chunks from ${chunks.length} to ${formattedChunks.length} (max tokens:${queryParam.max_token_for_text_unit})`,
			);

			return formattedChunks.join('\n--New Chunk--\n');
		} catch (e) {
			logger.error(`Error in getVectorContext: ${e}`);
			return null;
		}
	}

	// 3. Execute both retrievals in parallel
	const [kgContext, vectorContext] = await Promise.all([
		getKgContext(),
		getVectorContext(),
	]);

	// 4. Merge contexts
	if (kgContext === null && vectorContext === null) {
		return PROMPTS.fail_response;
	}

	if (queryParam.only_need_context) {
		return { kg_context: kgContext, vector_context: vectorContext };
	}

	// 5. Construct hybrid prompt
	const sysPrompt =
		systemPrompt ||
		PROMPTS.mix_rag_response.format({
			kg_context: kgContext || 'No relevant knowledge graph information found',
			vector_context: vectorContext || 'No relevant text information found',
			response_type: queryParam.response_type,
			history: historyContext,
		});

	if (queryParam.only_need_prompt) {
		return sysPrompt;
	}

	const lenOfPrompts = encodeStringByTiktoken(query + sysPrompt).length;
	logger.debug(`[mix_kg_vector_query]Prompt Tokens: ${lenOfPrompts}`);

	// 6. Generate response
	const response = await useModelFunc(query, {
		system_prompt: sysPrompt,
		stream: queryParam.stream,
	});

	// Clean up response content
	let processedResponse = response;
	if (typeof response === 'string' && response.length > sysPrompt.length) {
		processedResponse = response
			.replace(sysPrompt, '')
			.replace('user', '')
			.replace('model', '')
			.replace(query, '')
			.replace('<system>', '')
			.replace('</system>', '')
			.trim();

		// 7. Save cache - Only cache after collecting complete response
		await saveToCache(hashingKv, {
			args_hash: argsHash,
			content: processedResponse,
			prompt: query,
			quantized,
			min_val: minVal,
			max_val: maxVal,
			mode: 'mix',
			cache_type: 'query',
		} as CacheData);
	}

	return processedResponse;
}

async function _buildQueryContext(
	llKeywords: string,
	hlKeywords: string,
	knowledgeGraphInst: BaseGraphStorage,
	entitiesVdb: BaseVectorStorage,
	relationshipsVdb: BaseVectorStorage,
	textChunksDb: BaseKVStorage,
	queryParam: QueryParam,
): Promise<string | null> {
	logger.info(`Process ${process.pid} building query context...`);

	let entitiesContext: string, relationsContext: string, textUnitsContext: string;

	if (queryParam.mode === 'local') {
		[entitiesContext, relationsContext, textUnitsContext] = await _getNodeData(
			llKeywords,
			knowledgeGraphInst,
			entitiesVdb,
			textChunksDb,
			queryParam,
		);
	} else if (queryParam.mode === 'global') {
		[entitiesContext, relationsContext, textUnitsContext] = await _getEdgeData(
			hlKeywords,
			knowledgeGraphInst,
			relationshipsVdb,
			textChunksDb,
			queryParam,
		);
	} else {
		// hybrid mode
		const [llData, hlData] = await Promise.all([
			_getNodeData(
				llKeywords,
				knowledgeGraphInst,
				entitiesVdb,
				textChunksDb,
				queryParam,
			),
			_getEdgeData(
				hlKeywords,
				knowledgeGraphInst,
				relationshipsVdb,
				textChunksDb,
				queryParam,
			),
		]);

		const [llEntitiesContext, llRelationsContext, llTextUnitsContext] = llData;

		const [hlEntitiesContext, hlRelationsContext, hlTextUnitsContext] = hlData;

		[entitiesContext, relationsContext, textUnitsContext] = combineContexts(
			[hlEntitiesContext, llEntitiesContext],
			[hlRelationsContext, llRelationsContext],
			[hlTextUnitsContext, llTextUnitsContext],
		);
	}

	// Not necessary to use LLM to generate a response
	if (!entitiesContext.trim() && !relationsContext.trim()) {
		return null;
	}

	const result = `
      -----Entities-----
      \`\`\`csv
      ${entitiesContext}
      \`\`\`
      -----Relationships-----
      \`\`\`csv
      ${relationsContext}
      \`\`\`
      -----Sources-----
      \`\`\`csv
      ${textUnitsContext}
      \`\`\`
      `.trim();

	return result;
}

async function _getNodeData(
	query: string,
	knowledgeGraphInst: BaseGraphStorage,
	entitiesVdb: BaseVectorStorage,
	textChunksDb: BaseKVStorage,
	queryParam: QueryParam,
): Promise<[string, string, string]> {
	// Get similar entities
	logger.info(
		`Query nodes: ${query}, top_k: ${queryParam.top_k}, cosine: ${entitiesVdb.cosine_better_than_threshold}`,
	);

	const results = await entitiesVdb.query(query, queryParam.top_k, queryParam.ids);

	if (results.length === 0) {
		return ['', '', ''];
	}

	// Get entity information
	const nodeDataPromises = results.map((r) =>
		knowledgeGraphInst.getNode(r.entity_name),
	);
	const nodeDegreePromises = results.map((r) =>
		knowledgeGraphInst.nodeDegree(r.entity_name),
	);

	const [nodeDatas, nodeDegrees] = await Promise.all([
		Promise.all(nodeDataPromises),
		Promise.all(nodeDegreePromises),
	]);

	if (!nodeDatas.every((n) => n !== null)) {
		logger.warning('Some nodes are missing, maybe the storage is damaged');
	}

	const nodeDatasList = nodeDatas
		.map((n, i) => {
			if (n === null) return null;
			return {
				...n,
				entity_name: results[i].entity_name,
				rank: nodeDegrees[i],
			};
		})
		.filter((n) => n !== null);

	// Get entity text chunk and relations
	const [useTextUnits, useRelations] = await Promise.all([
		_findMostRelatedTextUnitFromEntities(
			nodeDatasList,
			queryParam,
			textChunksDb,
			knowledgeGraphInst,
		),
		_findMostRelatedEdgesFromEntities(
			nodeDatasList,
			queryParam,
			knowledgeGraphInst,
		),
	]);

	const lenNodeDatas = nodeDatasList.length;
	const truncatedNodeDatas = truncateListByTokenSize(
		nodeDatasList,
		(x) => x.description || '',
		queryParam.max_token_for_local_context,
	);

	logger.debug(
		`Truncate entities from ${lenNodeDatas} to ${truncatedNodeDatas.length} (max tokens:${queryParam.max_token_for_local_context})`,
	);

	logger.info(
		`Local query uses ${truncatedNodeDatas.length} entities, ${useRelations.length} relations, ${useTextUnits.length} chunks`,
	);

	// Build prompt
	const entitesSectionList = [
		['id', 'entity', 'type', 'description', 'rank', 'created_at'],
	];

	for (let i = 0; i < truncatedNodeDatas.length; i++) {
		const n = truncatedNodeDatas[i];
		let createdAt = n.created_at || 'UNKNOWN';
		if (typeof createdAt === 'number') {
			createdAt = new Date(createdAt * 1000)
				.toISOString()
				.replace('T', ' ')
				.substr(0, 19);
		}

		entitesSectionList.push([
			i,
			n.entity_name,
			n.entity_type || 'UNKNOWN',
			n.description || 'UNKNOWN',
			n.rank,
			createdAt,
		]);
	}

	const entitiesContext = listOfListToCsv(entitesSectionList);

	const relationsSectionList = [
		[
			'id',
			'source',
			'target',
			'description',
			'keywords',
			'weight',
			'rank',
			'created_at',
		],
	];

	for (let i = 0; i < useRelations.length; i++) {
		const e = useRelations[i];
		let createdAt = e.created_at || 'UNKNOWN';
		// Convert timestamp to readable format
		if (typeof createdAt === 'number') {
			createdAt = new Date(createdAt * 1000)
				.toISOString()
				.replace('T', ' ')
				.substr(0, 19);
		}

		relationsSectionList.push([
			i,
			e.src_tgt[0],
			e.src_tgt[1],
			e.description,
			e.keywords,
			e.weight,
			e.rank,
			createdAt,
		]);
	}

	const relationsContext = listOfListToCsv(relationsSectionList);

	const textUnitsSectionList = [['id', 'content']];
	for (let i = 0; i < useTextUnits.length; i++) {
		textUnitsSectionList.push([i, useTextUnits[i].content]);
	}

	const textUnitsContext = listOfListToCsv(textUnitsSectionList);

	return [entitiesContext, relationsContext, textUnitsContext];
}

async function _findMostRelatedTextUnitFromEntities(
	nodeDatas: any[],
	queryParam: QueryParam,
	textChunksDb: BaseKVStorage,
	knowledgeGraphInst: BaseGraphStorage,
): Promise<any[]> {
	const textUnits = nodeDatas.map((dp) =>
		splitStringByMultiMarkers(dp.source_id, [GRAPH_FIELD_SEP]),
	);

	const edges = await Promise.all(
		nodeDatas.map((dp) => knowledgeGraphInst.getNodeEdges(dp.entity_name)),
	);

	const allOneHopNodes = new Set<string>();
	for (const thisEdges of edges) {
		if (!thisEdges || !thisEdges.length) continue;
		for (const e of thisEdges) {
			allOneHopNodes.add(e[1]);
		}
	}

	const allOneHopNodesArray = Array.from(allOneHopNodes);
	const allOneHopNodesData = await Promise.all(
		allOneHopNodesArray.map((e) => knowledgeGraphInst.getNode(e)),
	);

	// Add null check for node data
	const allOneHopTextUnitsLookup: Record<string, Set<string>> = {};
	for (let i = 0; i < allOneHopNodesArray.length; i++) {
		const node = allOneHopNodesData[i];
		if (node !== null && node.source_id) {
			allOneHopTextUnitsLookup[allOneHopNodesArray[i]] = new Set(
				splitStringByMultiMarkers(node.source_id, [GRAPH_FIELD_SEP]),
			);
		}
	}

	const allTextUnitsLookup: Record<string, any> = {};
	const tasks: [string, number, any[]][] = [];

	for (let index = 0; index < textUnits.length; index++) {
		const thisTextUnits = textUnits[index];
		const thisEdges = edges[index];

		for (const cId of thisTextUnits) {
			if (!(cId in allTextUnitsLookup)) {
				allTextUnitsLookup[cId] = index;
				tasks.push([cId, index, thisEdges]);
			}
		}
	}

	const results = await Promise.all(
		tasks.map(([cId]) => textChunksDb.getById(cId)),
	);

	for (let i = 0; i < tasks.length; i++) {
		const [cId, index, thisEdges] = tasks[i];
		const data = results[i];

		allTextUnitsLookup[cId] = {
			data,
			order: index,
			relation_counts: 0,
		};

		if (thisEdges && thisEdges.length) {
			for (const e of thisEdges) {
				if (
					e[1] in allOneHopTextUnitsLookup &&
					allOneHopTextUnitsLookup[e[1]].has(cId)
				) {
					allTextUnitsLookup[cId].relation_counts += 1;
				}
			}
		}
	}

	// Filter out null values and ensure data has content
	const allTextUnits = Object.entries(allTextUnitsLookup)
		.filter(
			([_, v]) =>
				v !== null &&
				v.data !== null &&
				typeof v.data === 'object' &&
				'content' in v.data,
		)
		.map(([k, v]) => ({ id: k, ...v }));

	if (!allTextUnits.length) {
		logger.warning('No valid text units found');
		return [];
	}

	allTextUnits.sort((a, b) => {
		if (a.order !== b.order) return a.order - b.order;
		return b.relation_counts - a.relation_counts;
	});

	const truncatedTextUnits = truncateListByTokenSize(
		allTextUnits,
		(x) => x.data.content,
		queryParam.max_token_for_text_unit,
	);

	logger.debug(
		`Truncate chunks from ${Object.keys(allTextUnitsLookup).length} to ${truncatedTextUnits.length} (max tokens:${queryParam.max_token_for_text_unit})`,
	);

	return truncatedTextUnits.map((t) => t.data);
}

async function _findMostRelatedEdgesFromEntities(
	nodeDatas: any[],
	queryParam: QueryParam,
	knowledgeGraphInst: BaseGraphStorage,
): Promise<any[]> {
	const allRelatedEdges = await Promise.all(
		nodeDatas.map((dp) => knowledgeGraphInst.getNodeEdges(dp.entity_name)),
	);

	const allEdges: [string, string][] = [];
	const seen = new Set<string>();

	for (const thisEdges of allRelatedEdges) {
		if (!thisEdges) continue;

		for (const e of thisEdges) {
			const sortedEdge = [e[0], e[1]].sort().join(':');
			if (!seen.has(sortedEdge)) {
				seen.add(sortedEdge);
				allEdges.push([e[0], e[1]]);
			}
		}
	}

	const allEdgesPack = await Promise.all(
		allEdges.map((e) => knowledgeGraphInst.getEdge(e[0], e[1])),
	);

	const allEdgesDegree = await Promise.all(
		allEdges.map((e) => knowledgeGraphInst.edgeDegree(e[0], e[1])),
	);

	const allEdgesData = allEdges
		.map((k, i) => {
			const v = allEdgesPack[i];
			const d = allEdgesDegree[i];
			if (v === null) return null;
			return { src_tgt: k, rank: d, ...v };
		})
		.filter((x) => x !== null)
		.sort((a, b) => {
			if (b.rank !== a.rank) return b.rank - a.rank;
			return b.weight - a.weight;
		});

	const truncatedEdgesData = truncateListByTokenSize(
		allEdgesData,
		(x) => x.description || '',
		queryParam.max_token_for_global_context,
	);

	logger.debug(
		`Truncate relations from ${allEdges.length} to ${truncatedEdgesData.length} (max tokens:${queryParam.max_token_for_global_context})`,
	);

	return truncatedEdgesData;
}

//chatgpt
async function _getEdgeData(
	keywords: string[],
	knowledgeGraphInst: BaseGraphStorage,
	relationshipsVdb: BaseVectorStorage,
	textChunksDb: BaseKVStorage,
	queryParam: QueryParam,
): Promise<[string, string, string]> {
	consoleInfo(
		`Query edges: ${keywords}, top_k: ${queryParam.top_k}, cosine: ${relationshipsVdb.cosine_better_than_threshold}`,
	);

	const results = await relationshipsVdb.query(
		keywords,
		queryParam.top_k,
		queryParam.ids,
	);

	if (!results.length) {
		return ['', '', ''];
	}

	// Instead of asyncio.gather, we use Promise.all
	const [edgeDatasRaw, edgeDegree] = await Promise.all([
		Promise.all(
			results.map((r) => knowledgeGraphInst.getEdge(r['src_id'], r['tgt_id'])),
		),
		Promise.all(
			results.map((r) =>
				knowledgeGraphInst.edgeDegree(r['src_id'], r['tgt_id']),
			),
		),
	]);

	let edgeDatas = results
		.map((k, idx) => {
			const v = edgeDatasRaw[idx];
			const d = edgeDegree[idx];
			if (v == null) {
				return null;
			}
			return {
				src_id: k['src_id'],
				tgt_id: k['tgt_id'],
				rank: d,
				created_at: k['__created_at__'] || null,
				...v,
			};
		})
		.filter((item) => item !== null) as Array<{
		src_id: string;
		tgt_id: string;
		rank: number;
		created_at: number | string | null;
		weight?: number;
		description?: string;
		keywords?: string[];
		[key: string]: any;
	}>;

	// Sort by rank desc, then weight desc
	edgeDatas = edgeDatas.sort((a, b) => {
		// if rank is the same, compare weight
		if (b.rank === a.rank) {
			return (b.weight || 0) - (a.weight || 0);
		}
		return b.rank - a.rank;
	});

	// Truncate by token size
	edgeDatas = truncateListByTokenSize(
		edgeDatas,
		(x) => (x.description ? x.description : ''),
		queryParam.max_token_for_global_context,
	);

	// Retrieve relevant entities and text chunks
	const [useEntities, useTextUnits] = await Promise.all([
		_findMostRelatedEntitiesFromRelationships(
			edgeDatas,
			queryParam,
			knowledgeGraphInst,
		),
		_findRelatedTextUnitFromRelationships(edgeDatas, queryParam, textChunksDb),
	]);

	consoleInfo(
		`Global query uses ${useEntities.length} entites, ${edgeDatas.length} relations, ${useTextUnits.length} chunks`,
	);

	// Build CSV for relations
	const relationsSectionList: any[][] = [
		[
			'id',
			'source',
			'target',
			'description',
			'keywords',
			'weight',
			'rank',
			'created_at',
		],
	];

	edgeDatas.forEach((e, i) => {
		let createdAt: number | string | null = e.created_at ?? 'Unknown';
		if (typeof createdAt === 'number') {
			const dateObj = new Date(createdAt * 1000); // if seconds
			createdAt = dateObj.toISOString().replace('T', ' ').split('.')[0];
		}
		relationsSectionList.push([
			i,
			e.src_id,
			e.tgt_id,
			e.description,
			e.keywords,
			e.weight,
			e.rank,
			createdAt,
		]);
	});
	const relationsContext = listOfListToCsv(relationsSectionList);

	// Build CSV for entities
	const entitiesSectionList: any[][] = [
		['id', 'entity', 'type', 'description', 'rank'],
	];
	useEntities.forEach((n, i) => {
		let createdAt: number | string | null = n['created_at'] ?? 'Unknown';
		if (typeof createdAt === 'number') {
			const dateObj = new Date(createdAt * 1000);
			createdAt = dateObj.toISOString().replace('T', ' ').split('.')[0];
		}
		entitiesSectionList.push([
			i,
			n['entity_name'],
			n['entity_type'] || 'UNKNOWN',
			n['description'] || 'UNKNOWN',
			n['rank'],
			createdAt,
		]);
	});
	const entitiesContext = listOfListToCsv(entitiesSectionList);

	// Build CSV for text units
	const textUnitsSectionList: any[][] = [['id', 'content']];
	useTextUnits.forEach((t, i) => {
		textUnitsSectionList.push([i, t.content]);
	});
	const textUnitsContext = listOfListToCsv(textUnitsSectionList);

	return [entitiesContext, relationsContext, textUnitsContext];
}

/**
 * Find the most related entities from the given edges.
 */
async function _findMostRelatedEntitiesFromRelationships(
	edgeDatas: Array<{
		src_id: string;
		tgt_id: string;
		rank?: number;
		[key: string]: any;
	}>,
	queryParam: QueryParam,
	knowledgeGraphInst: BaseGraphStorage,
): Promise<Array<{ [key: string]: any }>> {
	const entityNames: string[] = [];
	const seen = new Set<string>();

	edgeDatas.forEach((e) => {
		if (!seen.has(e.src_id)) {
			entityNames.push(e.src_id);
			seen.add(e.src_id);
		}
		if (!seen.has(e.tgt_id)) {
			entityNames.push(e.tgt_id);
			seen.add(e.tgt_id);
		}
	});

	const [nodeDatasRaw, nodeDegrees] = await Promise.all([
		Promise.all(entityNames.map((name) => knowledgeGraphInst.getNode(name))),
		Promise.all(entityNames.map((name) => knowledgeGraphInst.nodeDegree(name))),
	]);

	let nodeDatas = nodeDatasRaw.map((n, idx) => {
		return {
			...n,
			entity_name: entityNames[idx],
			rank: nodeDegrees[idx],
		};
	});

	const lenNodeDatas = nodeDatas.length;
	nodeDatas = truncateListByTokenSize(
		nodeDatas,
		(x) => (x.description ? x.description : ''),
		queryParam.max_token_for_local_context,
	);
	console.debug(
		`Truncate entities from ${lenNodeDatas} to ${nodeDatas.length} (max tokens:${queryParam.max_token_for_local_context})`,
	);

	return nodeDatas;
}

/**
 * Find the related text units from the given edges.
 */
async function _findRelatedTextUnitFromRelationships(
	edgeDatas: Array<{
		source_id?: string;
		[key: string]: any;
	}>,
	queryParam: QueryParam,
	textChunksDb: BaseKVStorage,
): Promise<TextChunkSchema[]> {
	// source_id is something like "id1|id2" => we split by some marker
	const textUnitsArrays = edgeDatas.map((dp) =>
		splitStringByMultiMarkers(
			dp['source_id'] || '',
			['|'] /* or GRAPH_FIELD_SEP if you prefer */,
		),
	);

	const allTextUnitsLookup: { [key: string]: { data: any; order: number } } = {};

	async function fetchChunkData(cId: string, index: number) {
		if (!(cId in allTextUnitsLookup)) {
			const chunkData = await textChunksDb.getById(cId);
			if (chunkData && chunkData.content) {
				allTextUnitsLookup[cId] = {
					data: chunkData,
					order: index,
				};
			}
		}
	}

	const tasks: Array<Promise<void>> = [];
	textUnitsArrays.forEach((unitList, index) => {
		unitList.forEach((cId) => {
			tasks.push(fetchChunkData(cId, index));
		});
	});

	await Promise.all(tasks);

	const allTextUnitEntries = Object.entries(allTextUnitsLookup);
	if (!allTextUnitEntries.length) {
		console.warn('No valid text chunks found');
		return [];
	}

	// Flatten to an array
	let allTextUnits = allTextUnitEntries.map(([key, value]) => {
		return {
			id: key,
			...value,
		};
	});

	// Sort by `order`
	allTextUnits = allTextUnits.sort((a, b) => a.order - b.order);

	// Filter out invalid data
	const validTextUnits = allTextUnits.filter((t) => t.data && t.data.content);

	if (!validTextUnits.length) {
		console.warn('No valid text chunks after filtering');
		return [];
	}

	// Truncate
	const truncatedTextUnits = truncateListByTokenSize(
		validTextUnits,
		(x) => x.data.content,
		queryParam.max_token_for_text_unit,
	);
	console.debug(
		`Truncate chunks from ${validTextUnits.length} to ${truncatedTextUnits.length} (max tokens:${queryParam.max_token_for_text_unit})`,
	);

	const finalTextUnits = truncatedTextUnits.map((t) => t.data as TextChunkSchema);
	return finalTextUnits;
}

/**
 * Combine contexts for entities, relationships, and sources.
 * This function references helper `process_combine_contexts` which you may need to define.
 */
function combineContexts(
	entities: [string, string],
	relationships: [string, string],
	sources: [string, string],
): [string, string, string] {
	// Hypothetical function references
	const hlEntities = entities[0];
	const llEntities = entities[1];
	const hlRelationships = relationships[0];
	const llRelationships = relationships[1];
	const hlSources = sources[0];
	const llSources = sources[1];

	// Combine and deduplicate (assuming some hypothetical function)
	const combinedEntities = process_combine_contexts(hlEntities, llEntities);
	const combinedRelationships = process_combine_contexts(
		hlRelationships,
		llRelationships,
	);
	const combinedSources = process_combine_contexts(hlSources, llSources);

	return [combinedEntities, combinedRelationships, combinedSources];
}

/**
 * Naive query that retrieves top K chunks from VDB, then uses them in a simple RAG-like flow.
 */
async function naiveQuery(
	query: string,
	chunksVdb: BaseVectorStorage,
	textChunksDb: BaseKVStorage,
	queryParam: QueryParam,
	globalConfig: { [key: string]: any },
	hashingKv?: BaseKVStorage | null,
): Promise<string> {
	const useModelFunc = globalConfig['llm_model_func'];
	const argsHash = computeArgsHash(queryParam.mode, query, 'query');
	const [cachedResponse, quantized, minVal, maxVal] = await handleCache(
		hashingKv,
		argsHash,
		query,
		queryParam.mode,
		'query',
	);

	if (cachedResponse !== null) {
		return cachedResponse;
	}

	const results = await chunksVdb.query(query, queryParam.top_k, queryParam.ids);
	if (!results.length) {
		return PROMPTS['fail_response'];
	}

	const chunksIds = results.map((r) => r['id']);
	const chunks = await textChunksDb.getByIds(chunksIds);

	// Filter
	const validChunks = (chunks || []).filter((chunk) => chunk && chunk.content);

	if (!validChunks.length) {
		console.warn('No valid chunks found after filtering');
		return PROMPTS['fail_response'];
	}

	const maybeTrunChunks = truncateListByTokenSize(
		validChunks,
		(x) => x.content,
		queryParam.max_token_for_text_unit,
	);

	if (!maybeTrunChunks.length) {
		console.warn('No chunks left after truncation');
		return PROMPTS['fail_response'];
	}

	console.debug(
		`Truncate chunks from ${chunks.length} to ${maybeTrunChunks.length} (max tokens:${queryParam.max_token_for_text_unit})`,
	);

	const section = maybeTrunChunks.map((c) => c.content).join('\n--New Chunk--\n');

	if (queryParam.only_need_context) {
		return section;
	}

	// conversation history
	let historyContext = '';
	if (queryParam.conversation_history) {
		historyContext = getConversationTurns(
			queryParam.conversation_history,
			queryParam.history_turns,
		);
	}

	const systemPrompt =
		globalConfig['naive_rag_response'] || PROMPTS['naive_rag_response'];
	const sysPrompt = systemPrompt
		.replace('{content_data}', section)
		.replace('{response_type}', queryParam.response_type || '')
		.replace('{history}', historyContext);

	if (queryParam.only_need_prompt) {
		return sysPrompt;
	}

	const lenOfPrompts = encodeStringByTiktoken(query + sysPrompt).length;
	console.debug(`[naive_query] Prompt Tokens: ${lenOfPrompts}`);

	let response = await useModelFunc(query, { system_prompt: sysPrompt });

	// Attempt to strip repeated text
	if (typeof response === 'string' && response.length > sysPrompt.length) {
		response = response
			.replace(sysPrompt, '')
			.replace('user', '')
			.replace('model', '')
			.replace(query, '')
			.replace('<system>', '')
			.replace('</system>', '')
			.trim();
	}

	// Save to cache
	await saveToCache(hashingKv, {
		argsHash,
		content: response,
		prompt: query,
		quantized,
		minVal,
		maxVal,
		mode: queryParam.mode,
		cacheType: 'query',
	});

	return response;
}

/**
 * Use knowledge graph, HL/LL keywords, relationships, text chunk DB, etc., to build RAG context and query LLM.
 */
async function kgQueryWithKeywords(
	query: string,
	knowledgeGraphInst: BaseGraphStorage,
	entitiesVdb: BaseVectorStorage,
	relationshipsVdb: BaseVectorStorage,
	textChunksDb: BaseKVStorage,
	queryParam: QueryParam,
	globalConfig: { [key: string]: any },
	hashingKv?: BaseKVStorage | null,
): Promise<string> {
	const useModelFunc = globalConfig['llm_model_func'];
	const argsHash = computeArgsHash(queryParam.mode, query, 'query');
	const [cachedResponse, quantized, minVal, maxVal] = await handleCache(
		hashingKv,
		argsHash,
		query,
		queryParam.mode,
		'query',
	);

	if (cachedResponse !== null) {
		return cachedResponse;
	}

	// We'll rely on hl_keywords / ll_keywords from queryParam
	const hlKeywords = queryParam.hl_keywords || [];
	const llKeywords = queryParam.ll_keywords || [];

	// Flatten if needed
	const flatten = (arr: string[] | string[][]): string[] => {
		if (!Array.isArray(arr)) return [];
		if (arr.some((item) => Array.isArray(item))) {
			// flatten deeper
			return (arr as string[][]).reduce((acc, val) => acc.concat(val), []);
		}
		return arr as string[];
	};
	const hlKeywordsFlat = flatten(hlKeywords);
	const llKeywordsFlat = flatten(llKeywords);

	// If no keywords at all, just fail
	if (!hlKeywordsFlat.length && !llKeywordsFlat.length) {
		console.warn('No keywords found in query_param.');
		return PROMPTS['fail_response'];
	}

	// If needed, adjust modes if keywords are missing
	if (!llKeywordsFlat.length && ['local', 'hybrid'].includes(queryParam.mode)) {
		console.warn('low_level_keywords is empty, switching to global mode.');
		queryParam.mode = 'global';
	}
	if (!hlKeywordsFlat.length && ['global', 'hybrid'].includes(queryParam.mode)) {
		console.warn('high_level_keywords is empty, switching to local mode.');
		queryParam.mode = 'local';
	}

	// Build context
	const context = await _buildQueryContext(
		llKeywordsFlat.join(', '),
		hlKeywordsFlat.join(', '),
		knowledgeGraphInst,
		entitiesVdb,
		relationshipsVdb,
		textChunksDb,
		queryParam,
	);

	if (!context) {
		return PROMPTS['fail_response'];
	}

	if (queryParam.only_need_context) {
		return context;
	}

	// conversation history
	let historyContext = '';
	if (queryParam.conversation_history) {
		historyContext = getConversationTurns(
			queryParam.conversation_history,
			queryParam.history_turns,
		);
	}

	const sysPromptTemplate = PROMPTS['rag_response'];
	const sysPrompt = sysPromptTemplate
		.replace('{context_data}', context)
		.replace('{response_type}', queryParam.response_type || '')
		.replace('{history}', historyContext);

	if (queryParam.only_need_prompt) {
		return sysPrompt;
	}

	const lenOfPrompts = encodeStringByTiktoken(query + sysPrompt).length;
	console.debug(`[kg_query_with_keywords]Prompt Tokens: ${lenOfPrompts}`);

	let response = await useModelFunc(query, {
		system_prompt: sysPrompt,
		stream: queryParam.stream,
	});

	// Clean up
	if (typeof response === 'string' && response.length > sysPrompt.length) {
		response = response
			.replace(sysPrompt, '')
			.replace('user', '')
			.replace('model', '')
			.replace(query, '')
			.replace('<system>', '')
			.replace('</system>', '')
			.trim();
	}

	await saveToCache(hashingKv, {
		argsHash,
		content: response,
		prompt: query,
		quantized,
		minVal,
		maxVal,
		mode: queryParam.mode,
		cacheType: 'query',
	});

	return response;
}

/**
 * Extract keywords from the query and then direct to either kgQueryWithKeywords or naiveQuery, etc.
 */
async function queryWithKeywords(
	query: string,
	prompt: string,
	param: QueryParam,
	knowledgeGraphInst: BaseGraphStorage,
	entitiesVdb: BaseVectorStorage,
	relationshipsVdb: BaseVectorStorage,
	chunksVdb: BaseVectorStorage,
	textChunksDb: BaseKVStorage,
	globalConfig: { [key: string]: any },
	hashingKv?: BaseKVStorage | null,
): Promise<string> {
	// You presumably have a function to do actual keyword extraction
	// We'll do a stub for `extractKeywordsOnly`
	async function extractKeywordsOnly(
		text: string,
		param: QueryParam,
		globalConfig: { [key: string]: any },
		hashingKv?: BaseKVStorage | null,
	): Promise<[string[], string[]]> {
		// Stub that returns sample HL & LL
		return [
			['exampleHL1', 'exampleHL2'],
			['exampleLL1', 'exampleLL2'],
		];
	}

	const [hlKeywords, llKeywords] = await extractKeywordsOnly(
		query,
		param,
		globalConfig,
		hashingKv,
	);

	param.hl_keywords = hlKeywords;
	param.ll_keywords = llKeywords;

	const llKeywordsStr = llKeywords.join(', ');
	const hlKeywordsStr = hlKeywords.join(', ');

	const formattedQuestion = `${prompt}\n\n### Keywords:\nHigh-level: ${hlKeywordsStr}\nLow-level: ${llKeywordsStr}\n\n### Query:\n${query}`;

	if (
		param.mode === 'local' ||
		param.mode === 'global' ||
		param.mode === 'hybrid'
	) {
		return await kgQueryWithKeywords(
			formattedQuestion,
			knowledgeGraphInst,
			entitiesVdb,
			relationshipsVdb,
			textChunksDb,
			param,
			globalConfig,
			hashingKv,
		);
	} else if (param.mode === 'naive') {
		return await naiveQuery(
			formattedQuestion,
			chunksVdb,
			textChunksDb,
			param,
			globalConfig,
			hashingKv,
		);
	} else if (param.mode === 'mix') {
		// In your original code there's a reference to `mix_kg_vector_query`,
		// but that function isn't provided. Just a placeholder here.
		return await mixKgVectorQuery(
			formattedQuestion,
			knowledgeGraphInst,
			entitiesVdb,
			relationshipsVdb,
			chunksVdb,
			textChunksDb,
			param,
			globalConfig,
			hashingKv,
		);
	} else {
		throw new Error(`Unknown mode ${param.mode}`);
	}
}
