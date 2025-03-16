import { BaseKVStorage, BaseVectorStorage, QueryParam } from '../base';
import { LightRAGConfig } from '../lightrag';
import { encodeStringByTiktoken } from '../operate';
import { PROMPTS } from '../prompt';
import {
	computeArgsHash,
	truncateListByTokenSize,
	getConversationTurns,
} from '../utils';
import { handleCache, saveToCache } from '../utils/cache';

export async function naiveQuery(
	query: string,
	chunksVdb: BaseVectorStorage,
	textChunksDb: BaseKVStorage,
	queryParam: QueryParam,
	globalConfig: LightRAGConfig,
	hashingKv?: BaseKVStorage | null,
): Promise<string> {
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

	const systemPrompt = PROMPTS['naive_rag_response'];
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
		args_hash: argsHash,
		content: response,
		prompt: query,
		quantized: quantized,
		min_val: minVal,
		max_val: maxVal,
		mode: queryParam.mode,
		cache_type: 'query',
	});

	return response;
}
