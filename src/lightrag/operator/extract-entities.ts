import { LightRAGConfig } from '../lightrag';
import {
	BaseGraphStorage,
	BaseKVStorage,
	BaseVectorStorage,
	TextChunkSchema,
} from '../base';
import { GRAPH_FIELD_SEP, PROMPTS } from '../prompt';
import {
	computeArgsHash,
	computeMdHashId,
	Counter,
	DefaultMap,
	formatString,
} from '../utils';
import { CacheData, handleCache, saveToCache } from '../utils/cache';
import { splitStringByMultiMarkers } from '../utils';
import { cleanStr, isFloatRegex, packUserAssToOpenaiMessages } from '../utils';
import { decodeTokensByTiktoken, encodeStringByTiktoken } from '../operate';

export async function extractEntities(
	chunks: Record<string, TextChunkSchema>,
	knowledgeGraphInst: BaseGraphStorage,
	entityVdb: BaseVectorStorage,
	relationshipsVdb: BaseVectorStorage,
	globalConfig: LightRAGConfig,
	llmResponseCache: BaseKVStorage | null = null,
): Promise<void> {
	const useLlmFunc: CallableFunction = globalConfig.llmModelFunc;
	const entityExtractMaxGleaning = globalConfig.entityExtractMaxGleaning;
	const enableLlmCacheForEntityExtract: boolean =
		globalConfig.enableLlmCacheForEntityExtract;

	const orderedChunks = Object.entries(chunks);

	// Add language and example number params to prompt
	const language = globalConfig.addonParams.language || PROMPTS.DEFAULT_LANGUAGE;
	const entityTypes =
		globalConfig.addonParams.entityTypes || PROMPTS.DEFAULT_ENTITY_TYPES;
	const exampleNumber = globalConfig.addonParams.exampleNumber;

	console.log({
		language,
		entityTypes,
		exampleNumber,
		entityExtractMaxGleaning,
		enableLlmCacheForEntityExtract,
	});

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

	examples = examples.replace(
		/{(\w+)}/g,
		(match, key) =>
			exampleContextBase[key as keyof typeof exampleContextBase] || match,
	);

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
			// if (historyMessages) {
			// 	const history = JSON.stringify(historyMessages);
			// 	_prompt = `${history}\n${inputText}`;
			// } else {
			// }
			const _prompt = inputText;

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
				console.debug(`Found cache for ${argHash}`);
				return cachedReturn;
			}

			let res: string;

			if (historyMessages) {
				res = await useLlmFunc(inputText, {
					historyMessages: historyMessages,
				});
			} else {
				res = await useLlmFunc(inputText, {});
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
				historyMessages: historyMessages,
			});
		} else {
			return await useLlmFunc(inputText, {});
		}
	}

	async function _processExtractionResult(result: string, chunkKey: string) {
		const maybeNodes: DefaultMap<string, any[]> = new DefaultMap(Array);
		const maybeEdges: DefaultMap<string, any[]> = new DefaultMap(Array);

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
		const partialTemplate = formatString(entityExtractPrompt, {
			...contextBase,
			input_text: '{input_text}',
		});

		// Second format: Replace the remaining {input_text} with actual content
		const hintPrompt = formatString(partialTemplate, {
			...contextBase,
			input_text: content,
		});
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

		console.log(logMessage);

		return [maybeNodes, maybeEdges];
	}

	// Process all chunks in parallel
	const taskPromises = orderedChunks.map((c) => _processSingleContent(c));
	const results = await Promise.all(taskPromises);

	// Combine all results
	const maybeNodes = new Map<string, any[]>();
	const maybeEdges = new Map<string, any[]>();

	console.log('--------------------------------');
	console.log('results', results);
	console.log('--------------------------------');

	for (const [mNodes, mEdges] of results) {
		console.log('mNodes', mNodes);
		console.log('mEdges', mEdges);
		for (const [k, v] of Object.entries(mNodes)) {
			maybeNodes.set(k, [...(maybeNodes.get(k) || []), ...v]);
		}
		for (const [k, v] of Object.entries(mEdges)) {
			const [src, tgt] = k.split(':');
			const sortedKey = [src, tgt].sort().join(':');
			maybeEdges.set(sortedKey, [...(maybeEdges.get(sortedKey) || []), ...v]);
		}
	}

	console.log('results', maybeNodes, maybeEdges);

	try {
		// Process nodes
		console.log('maybeNodes', [...maybeNodes.entries()]);
		const nodePromises = [...maybeNodes.entries()].map(([k, v]) =>
			_mergeNodesThenUpsert(k, v, knowledgeGraphInst, globalConfig),
		);
		const allEntitiesData = await Promise.all(nodePromises);
		console.log('allEntitiesData', allEntitiesData);

		// Process edges
		const edgePromises = [...maybeEdges.entries()].map(([k, v]) => {
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
			console.log(logMessage);
			return;
		}

		if (!allEntitiesData.length) {
			const logMessage = "Didn't extract any entities";
			console.log(logMessage);
		}

		if (!allRelationshipsData.length) {
			const logMessage = "Didn't extract any relationships";
			console.log(logMessage);
		}

		const logMessage = `Extracted ${allEntitiesData.length} entities and ${allRelationshipsData.length} relationships (deduplicated)`;
		console.log(logMessage);

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

			console.log('dataForVdb', dataForVdb);
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
		//
	}
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
		console.warn(
			`Entity extraction error: empty entity name in: ${recordAttributes}`,
		);
		return null;
	}

	// Clean and validate entity type
	const entityType = cleanStr(recordAttributes[2]).replace(/^"|"$/g, '');
	if (!entityType.trim() || entityType.startsWith('("')) {
		console.warn(
			`Entity extraction error: invalid entity type in: ${recordAttributes}`,
		);
		return null;
	}

	// Clean and validate description
	const entityDescription = cleanStr(recordAttributes[3]).replace(/^"|"$/g, '');
	if (!entityDescription.trim()) {
		console.warn(
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

async function _mergeEdgesThenUpsert(
	srcId: string,
	tgtId: string,
	edgesData: Record<string, any>[],
	knowledgeGraphInst: BaseGraphStorage,
	globalConfig: LightRAGConfig,
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
			alreadyWeights.push(+alreadyEdge.weight || 0);

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

async function _handleEntityRelationSummary(
	entityOrRelationName: string,
	description: string,
	globalConfig: LightRAGConfig,
): Promise<string> {
	const useLlmFunc: CallableFunction = globalConfig.llmModelFunc;
	console.log('useLlmFunc', useLlmFunc, globalConfig);
	const llmMaxTokens = globalConfig.llmModelMaxTokenSize;
	const summaryMaxTokens = globalConfig.entitySummaryToMaxTokens;
	const language = globalConfig.addonParams.language || PROMPTS.DEFAULT_LANGUAGE;

	const tokens = encodeStringByTiktoken(description);
	if (tokens.length < summaryMaxTokens) {
		// No need for summary
		return description;
	}

	const promptTemplate = PROMPTS.summarize_entity_descriptions;
	const useDescription = decodeTokensByTiktoken(tokens.slice(0, llmMaxTokens));

	const contextBase = {
		entity_name: entityOrRelationName,
		description_list: useDescription.split(GRAPH_FIELD_SEP),
		language,
	};

	const usePrompt = promptTemplate.format(contextBase);
	console.debug(`Trigger summary: ${entityOrRelationName}`);
	const summary = await useLlmFunc(usePrompt, { max_tokens: summaryMaxTokens });
	return summary;
}

async function _mergeNodesThenUpsert(
	entityName: string,
	nodesData: Record<string, any>[],
	knowledgeGraphInst: BaseGraphStorage,
	globalConfig: LightRAGConfig,
): Promise<Record<string, any>> {
	// Add type checking
	if (!Array.isArray(nodesData)) {
		console.warn(`nodesData is not an array for entity ${entityName}`);
		nodesData = [nodesData]; // Convert to array if single object
	}

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
