import { PROMPTS } from '../prompt';
import {
	cosineSimilarity,
	dequantizeEmbedding,
	quantizeEmbedding,
} from './embeddings';

export class CacheData {
	args_hash: string;
	content: string;
	prompt: string;
	quantized: Uint8Array | null;
	min_val: number | null;
	max_val: number | null;
	mode: string;
	cache_type: string;

	constructor(
		args_hash: string,
		content: string,
		prompt: string,
		quantized: Uint8Array | null = null,
		min_val: number | null = null,
		max_val: number | null = null,
		mode: string = 'default',
		cache_type: string = 'query',
	) {
		this.args_hash = args_hash;
		this.content = content;
		this.prompt = prompt;
		this.quantized = quantized;
		this.min_val = min_val;
		this.max_val = max_val;
		this.mode = mode;
		this.cache_type = cache_type;
	}
}

const statisticData = {
	llm_call: 0,
	llm_cache: 0,
	embed_call: 0,
};

/**
 * Get best cached response based on embedding similarity
 */
export async function getBestCachedResponse(
	hashingKv: any,
	currentEmbedding: number[],
	similarityThreshold: number = 0.95,
	mode: string = 'default',
	useLlmCheck: boolean = false,
	llmFunc: any = null,
	originalPrompt: string | null = null,
	cacheType: string | null = null,
): Promise<string | null> {
	console.debug(
		`getBestCachedResponse: mode=${mode} cacheType=${cacheType} useLlmCheck=${useLlmCheck}`,
	);

	const modeCache = await hashingKv.getById(mode);
	if (!modeCache) {
		return null;
	}

	let bestSimilarity = -1;
	let bestResponse = null;
	let bestPrompt = null;
	let bestCacheId = null;

	// Only iterate through cache entries for this mode
	for (const cacheId in modeCache) {
		const cacheData = modeCache[cacheId];

		// Skip if cacheType doesn't match
		if (cacheType && cacheData.cache_type !== cacheType) {
			continue;
		}

		if (!cacheData.embedding) {
			continue;
		}

		// Convert cached embedding hex to array
		const cachedQuantizedBuffer = Buffer.from(cacheData.embedding, 'hex');
		const cachedQuantized = new Uint8Array(cachedQuantizedBuffer);

		// Reshape if necessary
		const embeddingShape = cacheData.embedding_shape;
		const cachedEmbedding = dequantizeEmbedding(
			cachedQuantized,
			cacheData.embedding_min,
			cacheData.embedding_max,
		);

		const similarity = cosineSimilarity(
			currentEmbedding,
			Array.from(cachedEmbedding),
		);
		if (similarity > bestSimilarity) {
			bestSimilarity = similarity;
			bestResponse = cacheData.return;
			bestPrompt = cacheData.original_prompt;
			bestCacheId = cacheId;
		}
	}

	if (bestSimilarity > similarityThreshold) {
		// If LLM check is enabled and all required parameters are provided
		if (
			useLlmCheck &&
			llmFunc &&
			originalPrompt &&
			bestPrompt &&
			bestResponse !== null
		) {
			const comparePrompt = PROMPTS.similarity_check
				.replace('{original_prompt}', originalPrompt)
				.replace('{cached_prompt}', bestPrompt);

			try {
				const llmResult = await llmFunc(comparePrompt);
				const llmSimilarity = parseFloat(llmResult.trim());

				// Replace vector similarity with LLM similarity score
				bestSimilarity = llmSimilarity;
				if (bestSimilarity < similarityThreshold) {
					const logData = {
						event: 'cache_rejected_by_llm',
						type: cacheType,
						mode: mode,
						original_question:
							originalPrompt.length > 100
								? originalPrompt.substring(0, 100) + '...'
								: originalPrompt,
						cached_question:
							bestPrompt.length > 100
								? bestPrompt.substring(0, 100) + '...'
								: bestPrompt,
						similarity_score: Math.round(bestSimilarity * 10000) / 10000,
						threshold: similarityThreshold,
					};
					console.debug(JSON.stringify(logData));
					console.log(
						`Cache rejected by LLM(mode:${mode} type:${cacheType})`,
					);
					return null;
				}
			} catch (e) {
				console.warn(`LLM similarity check failed: ${e}`);
				return null; // Return null directly when LLM check fails
			}
		}

		const promptDisplay =
			bestPrompt.length > 50
				? bestPrompt.substring(0, 50) + '...'
				: bestPrompt;

		const logData = {
			event: 'cache_hit',
			type: cacheType,
			mode: mode,
			similarity: Math.round(bestSimilarity * 10000) / 10000,
			cache_id: bestCacheId,
			original_prompt: promptDisplay,
		};
		console.debug(JSON.stringify(logData));
		return bestResponse;
	}

	return null;
}

/**
 * Generic cache handling function
 */
export async function handleCache(
	hashingKv: any,
	argsHash: string,
	prompt: string,
	mode: string = 'default',
	cacheType: string | null = null,
): Promise<[string | null, Uint8Array | null, number | null, number | null]> {
	if (!hashingKv) {
		return [null, null, null, null];
	}

	if (mode !== 'default') {
		// handle cache for all type of query
		if (!hashingKv.global_config?.enable_llm_cache) {
			return [null, null, null, null];
		}

		// Get embedding cache configuration
		const embeddingCacheConfig = hashingKv.global_config
			?.embedding_cache_config || {
			enabled: false,
			similarity_threshold: 0.95,
			use_llm_check: false,
		};

		const isEmbeddingCacheEnabled = embeddingCacheConfig.enabled;
		const useLlmCheck = embeddingCacheConfig.use_llm_check || false;

		let quantized = null;
		let minVal = null;
		let maxVal = null;

		if (isEmbeddingCacheEnabled) {
			// Use embedding similarity to match cache
			const currentEmbedding = await hashingKv.embedding_func([prompt]);
			const llmModelFunc = hashingKv.global_config?.llm_model_func;

			const [quantizedArray, minValNum, maxValNum] = quantizeEmbedding(
				currentEmbedding[0],
			);
			quantized = quantizedArray;
			minVal = minValNum;
			maxVal = maxValNum;

			const bestCachedResponse = await getBestCachedResponse(
				hashingKv,
				currentEmbedding[0],
				embeddingCacheConfig.similarity_threshold,
				mode,
				useLlmCheck,
				useLlmCheck ? llmModelFunc : null,
				prompt,
				cacheType,
			);

			if (bestCachedResponse !== null) {
				console.debug(
					`Embedding cached hit(mode:${mode} type:${cacheType})`,
				);
				return [bestCachedResponse, null, null, null];
			} else {
				// If caching keyword embedding is enabled, return the quantized embedding for saving it later
				console.debug(
					`Embedding cached missed(mode:${mode} type:${cacheType})`,
				);
				return [null, quantized, minVal, maxVal];
			}
		}
	} else {
		// handle cache for entity extraction
		if (!hashingKv.global_config?.enable_llm_cache_for_entity_extract) {
			return [null, null, null, null];
		}
	}

	// Here is the conditions of code reaching this point:
	//     1. All query mode: enable_llm_cache is True and embedding similarity is not enabled
	//     2. Entity extract: enable_llm_cache_for_entity_extract is True

	const existsFunc = (obj: any, funcName: string): boolean => {
		return typeof obj[funcName] === 'function';
	};

	let modeCache;
	if (existsFunc(hashingKv, 'getByModeAndId')) {
		modeCache = (await hashingKv.getByModeAndId(mode, argsHash)) || {};
	} else {
		modeCache = (await hashingKv.getById(mode)) || {};
	}

	if (modeCache[argsHash]) {
		console.debug(`Non-embedding cached hit(mode:${mode} type:${cacheType})`);
		return [modeCache[argsHash].return, null, null, null];
	}

	console.debug(`Non-embedding cached missed(mode:${mode} type:${cacheType})`);
	return [null, null, null, null];
}

/**
 * Save data to cache, with improved handling for streaming responses and duplicate content.
 *
 * @param hashingKv The key-value storage for caching
 * @param cacheData The cache data to save
 */
export async function saveToCache(
	hashingKv: any,
	cacheData: CacheData,
): Promise<void> {
	// Skip if storage is None or content is empty
	if (!hashingKv || !cacheData.content) {
		return;
	}

	// If content is a streaming response (has __aiter__ method), don't cache it
	if (
		typeof cacheData.content === 'object' &&
		cacheData.content !== null &&
		'__aiter__' in (cacheData.content as any)
	) {
		console.debug('Streaming response detected, skipping cache');
		return;
	}

	// Get existing cache data
	const existsFunc = (obj: any, funcName: string): boolean => {
		return typeof obj[funcName] === 'function';
	};

	let modeCache;
	if (existsFunc(hashingKv, 'getByModeAndId')) {
		modeCache =
			(await hashingKv.getByModeAndId(cacheData.mode, cacheData.args_hash)) ||
			{};
	} else {
		modeCache = (await hashingKv.getById(cacheData.mode)) || {};
	}

	// Check if we already have identical content cached
	if (modeCache[cacheData.args_hash]) {
		const existingContent = modeCache[cacheData.args_hash].return;
		if (existingContent === cacheData.content) {
			console.log(
				`Cache content unchanged for ${cacheData.args_hash}, skipping update`,
			);
			return;
		}
	}

	// Update cache with new content
	modeCache[cacheData.args_hash] = {
		return: cacheData.content,
		cache_type: cacheData.cache_type,
		embedding: cacheData.quantized
			? Buffer.from(cacheData.quantized).toString('hex')
			: null,
		embedding_shape: cacheData.quantized ? cacheData.quantized.length : null,
		embedding_min: cacheData.min_val,
		embedding_max: cacheData.max_val,
		original_prompt: cacheData.prompt,
	};

	// Only upsert if there's actual new content
	await hashingKv.upsert({ [cacheData.mode]: modeCache });
}
