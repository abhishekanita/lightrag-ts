import {
	BaseGraphStorage,
	BaseKVStorage,
	BaseVectorStorage,
	QueryParam,
} from '../base';
import { LightRAGConfig } from '../lightrag';
import { encodeStringByTiktoken } from '../operate';
import { PROMPTS } from '../prompt';
import {
	computeArgsHash,
	formatString,
	getConversationTurns,
	processCombineContexts,
} from '../utils';
import { CacheData, handleCache, saveToCache } from '../utils/cache';
import { _getNodeData } from './retrieve-entities';
import { _getEdgeData } from './retrieve-relationships';

export async function kgQuery(
	query: string,
	knowledgeGraphInst: BaseGraphStorage,
	entitiesVdb: BaseVectorStorage,
	relationshipsVdb: BaseVectorStorage,
	textChunksDb: BaseKVStorage,
	queryParam: QueryParam,
	globalConfig: LightRAGConfig,
	hashingKv: BaseKVStorage | null = null,
	systemPrompt: string | null = null,
): Promise<string | AsyncIterator<string>> {
	// Handle cache
	const useModelFunc = globalConfig.llmModelFunc;
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
	console.log(hlKeywords, llKeywords);

	console.debug(`High-level keywords: ${hlKeywords}`);
	console.debug(`Low-level keywords: ${llKeywords}`);

	// Handle empty keywords
	if (hlKeywords.length === 0 && llKeywords.length === 0) {
		console.warn('low_level_keywords and high_level_keywords is empty');
		return PROMPTS.fail_response;
	}

	if (llKeywords.length === 0 && ['local', 'hybrid'].includes(queryParam.mode)) {
		console.warn(
			`low_level_keywords is empty, switching from ${queryParam.mode} mode to global mode`,
		);
		queryParam.mode = 'global';
	}

	if (hlKeywords.length === 0 && ['global', 'hybrid'].includes(queryParam.mode)) {
		console.warn(
			`high_level_keywords is empty, switching from ${queryParam.mode} mode to local mode`,
		);
		queryParam.mode = 'local';
	}

	const llKeywordsStr = llKeywords.length ? llKeywords.join(', ') : '';
	const hlKeywordsStr = hlKeywords.length ? hlKeywords.join(', ') : '';

	console.log('llKeywordsStr', llKeywordsStr);
	console.log('hlKeywordsStr', hlKeywordsStr);

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

	console.log('context', context);

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

	console.log('historyContext', historyContext);

	const sysPromptTemp = systemPrompt || PROMPTS.rag_response;

	const sysPrompt = formatString(sysPromptTemp, {
		context_data: context,
		response_type: queryParam.response_type,
		history: historyContext,
	});

	console.log('sysPrompt', sysPrompt);

	if (queryParam.only_need_prompt) {
		return sysPrompt;
	}

	const lenOfPrompts = encodeStringByTiktoken(query + sysPrompt).length;
	console.debug(`[kg_query]Prompt Tokens: ${lenOfPrompts}`);

	const response = await useModelFunc(query, {
		system_prompt: sysPrompt,
		stream: queryParam.stream,
	});

	console.log('response', response);

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
	globalConfig: LightRAGConfig,
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
			console.warn(
				'Invalid cache format for keywords, proceeding with extraction',
			);
		}
	}

	// 2. Build the examples
	const exampleNumber = globalConfig.addonParams?.example_number;
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

	const language = globalConfig.addonParams?.language || PROMPTS.DEFAULT_LANGUAGE;

	// 3. Process conversation history
	let historyContext = '';
	if (param.conversation_history) {
		historyContext = getConversationTurns(
			param.conversation_history,
			param.history_turns,
		);
	}

	// 4. Build the keyword-extraction prompt
	const kwPrompt = formatString(PROMPTS.keywords_extraction, {
		query: text,
		examples,
		language,
		history: historyContext,
	});

	const lenOfPrompts = encodeStringByTiktoken(kwPrompt).length;
	console.debug(`[kg_query]Prompt Tokens: ${lenOfPrompts}`);

	// 5. Call the LLM for keyword extraction
	const useModelFunc = globalConfig.llmModelFunc;
	const result = await useModelFunc(kwPrompt, { keyword_extraction: true });

	// 6. Parse out JSON from the LLM response
	const match = result.match(/\{.*\}/s);
	if (!match) {
		console.error('No JSON-like structure found in the LLM respond.');
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
		console.error(`JSON parsing error: ${e}`);
		return [[], []];
	}
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
	console.info(`Process ${process.pid} building query context...`);

	console.log('--------------------------------');

	let entitiesContext: string, relationsContext: string, textUnitsContext: string;
	console.log(queryParam.mode);
	if (queryParam.mode === 'local') {
		console.log('llKeywords', llKeywords);
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
	const combinedEntities = processCombineContexts(hlEntities, llEntities);
	const combinedRelationships = processCombineContexts(
		hlRelationships,
		llRelationships,
	);
	const combinedSources = processCombineContexts(hlSources, llSources);

	return [combinedEntities, combinedRelationships, combinedSources];
}
