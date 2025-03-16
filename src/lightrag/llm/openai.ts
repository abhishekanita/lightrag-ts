import { APIConnectionError, OpenAI, RateLimitError } from 'openai';
import { config } from '../../config';
import { safeUnicodeDecode } from '../utils';
import { APITimeoutError } from '../exceptions';

async function openaiCompleteIfCache(
	model: string,
	prompt: string,
	data: {
		systemPrompt?: string;
		historyMessages?: any[];
		base_url?: string;
		[key: string]: any;
	},
): Promise<string | AsyncIterable<string>> {
	const messages: any[] = [];
	const { systemPrompt, historyMessages, ...restOptions } = data;

	if (systemPrompt) {
		messages.push({ role: 'system', content: systemPrompt });
	}

	if (historyMessages && historyMessages.length > 0) {
		messages.push(...historyMessages);
	}

	messages.push({ role: 'user', content: prompt });
	// console.log('options', restOptions);

	// Remove options that are handled separately
	const { hashing_kv, keyword_extraction, ...rest } = restOptions;

	const openaiClient = new OpenAI({
		apiKey: config.openaiApiKey,
	});

	// console.log('===== Sending Query to LLM =====');
	// console.log(`Model: ${model}   `);
	// console.log(`Additional options: ${JSON.stringify(rest)}`);

	try {
		let response;
		if (rest.responseFormat) {
			response = await openaiClient.beta.chat.completions.parse({
				model,
				messages,
				...rest,
			});
		} else {
			response = await openaiClient.chat.completions.create({
				model,
				messages,
				...rest,
			});
		}

		// Handle regular response
		if (
			!response.choices ||
			!response.choices[0] ||
			!response.choices[0].message ||
			!response.choices[0].message.content
		) {
			console.log('Invalid response from OpenAI API');
			throw new Error('Invalid response from OpenAI API');
		}

		let content = response.choices[0].message.content;

		if (!content || content.trim() === '') {
			console.log('Received empty content from OpenAI API');
			throw new Error('Received empty content from OpenAI API');
		}

		// Handle unicode escapes
		if (content.includes('\\u')) {
			content = safeUnicodeDecode(content);
		}

		return content;
	} catch (error) {
		if (error instanceof APIConnectionError) {
			console.log(`OpenAI API Connection Error: ${error.message}`);
		} else if (error instanceof RateLimitError) {
			console.log(`OpenAI API Rate Limit Error: ${error.message}`);
		} else if (error instanceof APITimeoutError) {
			console.log(`OpenAI API Timeout Error: ${error.message}`);
		} else {
			console.log(
				`OpenAI API Call Failed, Model: ${model}, Params: ${JSON.stringify(rest)}, Got: ${error}`,
			);
		}
		throw error;
	}
}

export async function gpt4oMiniComplete(
	prompt: string,
	data: {
		systemPrompt: string;
		historyMessages: any[];
		keywordExtraction: boolean;
		[key: string]: any;
	},
): Promise<any> {
	if (data?.historyMessages?.length === 0) {
		data.historyMessages = [];
	}
	if (data?.keywordExtraction) {
		data.restOptions.responseFormat = {
			high_level_keywords: [],
			low_level_keywords: [],
		};
	}

	return await openaiCompleteIfCache('gpt-4o-mini', prompt, {
		systemPrompt: data.systemPrompt,
		historyMessages: data.historyMessages,
		...data.restOptions,
	});
}

export async function openaiEmbed(texts: string[]): Promise<number[][]> {
	const model = 'text-embedding-3-small';

	const openaiAsyncClient = new OpenAI({
		apiKey: config.openaiApiKey,
	});

	const response = await openaiAsyncClient.embeddings.create({
		model: model,
		input: texts,
		encoding_format: 'float',
	});

	return response.data.map((dp) => dp.embedding);
}
