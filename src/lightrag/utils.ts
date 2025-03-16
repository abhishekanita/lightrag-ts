import { STORAGE_ENV_REQUIREMENTS } from './kg';
import { createHash } from 'crypto';
import * as cheerio from 'cheerio';
import Papa from 'papaparse';
import { encodeStringByTiktoken } from './operate';
import { stringify } from 'csv-stringify/sync';

export function limitAsyncFuncCall(maxSize: number) {
	return function decorator<T extends (...args: any[]) => Promise<any>>(
		func: T,
	): T {
		//implement using p-limit
		return func;
	};
}

export function checkStorageEnvVars(storageName: string): void {
	const required_vars = STORAGE_ENV_REQUIREMENTS[storageName];
	const missing_vars = required_vars.filter((name) => {
		const value = process.env[name];
		console.log('value', value);
		if (!value) {
			return true;
		}
		return false;
	});
	console.log('required_vars', storageName, required_vars, missing_vars);
	if (missing_vars.length > 0) {
		throw new Error(
			`Storage implementation '${storageName}' requires the following ` +
				`environment variables: ${missing_vars.join(', ')}`,
		);
	}
}

export function convertResponseToJson(response: string): Record<string, any> {
	const jsonStr = locateJsonStringBodyFromString(response);
	if (!jsonStr) {
		throw new Error(`Unable to parse JSON from response: ${response}`);
	}

	try {
		const data = JSON.parse(jsonStr);
		return data;
	} catch (e) {
		console.error(`Failed to parse JSON: ${jsonStr}`);
		throw e;
	}
}

export function locateJsonStringBodyFromString(content: string): string | null {
	try {
		const maybeJsonStrMatch = content.match(/{.*}/s);
		if (maybeJsonStrMatch) {
			let maybeJsonStr = maybeJsonStrMatch[0];
			maybeJsonStr = maybeJsonStr.replace(/\\n/g, '');
			maybeJsonStr = maybeJsonStr.replace(/\n/g, '');
			maybeJsonStr = maybeJsonStr.replace(/'/g, '"');
			// Don't check here, cannot validate schema after all
			return maybeJsonStr;
		}
	} catch (error) {
		// Do nothing
	}

	return null;
}

export function computeMdHashId(content: string, prefix: string = ''): string {
	return prefix + createHash('md5').update(content).digest('hex');
}

export function cleanText(text: string): string {
	return text.trim().replace('\x00', '');
}

export function getContentSummary(
	content: string,
	max_length: number = 100,
): string {
	content = content.trim();
	if (content.length <= max_length) {
		return content;
	}
	return content.slice(0, max_length) + '...';
}

export function computeArgsHash(...args: any[]): string {
	// Convert all arguments to strings and join them
	const argsStr = args.map((arg) => String(arg)).join('');

	// Compute MD5 hash
	return createHash('md5').update(argsStr).digest('hex');
}

export class DefaultMap<K, V> extends Map<K, V> {
	private defaultFactory: () => V;

	constructor(defaultFactory: () => V) {
		super();
		this.defaultFactory = defaultFactory;
	}

	get(key: K): V {
		if (!this.has(key)) {
			this.set(key, this.defaultFactory());
		}
		return super.get(key) as V;
	}
}

/**
 * Split a string by multiple markers
 */
export function splitStringByMultiMarkers(
	content: string,
	markers: string[],
): string[] {
	if (!markers.length) {
		return [content];
	}

	// Create a regex pattern with all markers escaped and joined with |
	const pattern = markers
		.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
		.join('|');
	const regex = new RegExp(pattern, 'g');

	// Split by the pattern
	const results = content
		.split(regex)
		.map((r) => r.trim())
		.filter((r) => r);

	return results;
}

export function cleanStr(input: any): any {
	// If we get non-string input, just give it back
	if (typeof input !== 'string') {
		return input;
	}

	// Use cheerio to unescape HTML
	const $ = cheerio.load(`<div>${input.trim()}</div>`);
	const result = $('div').text();

	// Remove control characters
	return result.replace(/[^\x20-\x7E]/g, '');
}

export function packUserAssToOpenaiMessages(
	...args: string[]
): Array<{ role: string; content: string }> {
	const roles = ['user', 'assistant'];
	return args.map((content, i) => ({
		role: roles[i % 2],
		content,
	}));
}

export function isFloatRegex(value: string): boolean {
	return /^[-+]?[0-9]*\.?[0-9]+$/.test(value);
}

export class Counter {
	private counts: Map<string, number>;

	constructor() {
		this.counts = new Map<string, number>();
	}

	add(item: string): void {
		this.counts.set(item, (this.counts.get(item) || 0) + 1);
	}

	entries(): [string, number][] {
		return Array.from(this.counts.entries());
	}

	get(item: string): number {
		return this.counts.get(item) || 0;
	}

	mostCommon(n?: number): [string, number][] {
		const sorted = this.entries().sort((a, b) => b[1] - a[1]);
		return n ? sorted.slice(0, n) : sorted;
	}
}

export function formatString(template: string, data: Record<string, any>): string {
	return template.replace(/{(\w+)}/g, (match, key) => {
		return data[key] !== undefined ? data[key] : match;
	});
}

export function safeUnicodeDecode(content: string): string {
	try {
		return JSON.parse(`"${content}"`);
	} catch (e) {
		return content;
	}
}

export function getConversationTurns(
	conversationHistory: any[],
	numTurns: number,
): string {
	/**
	 * Process conversation history to get the specified number of complete turns.
	 *
	 * @param conversationHistory - List of conversation messages in chronological order
	 * @param numTurns - Number of complete turns to include
	 * @returns Formatted string of the conversation history
	 */

	// Check if numTurns is valid
	if (numTurns <= 0) {
		return '';
	}

	// Group messages into turns
	const turns: any[][] = [];
	const messages: any[] = [];

	// First, filter out keyword extraction messages
	for (const msg of conversationHistory) {
		if (
			msg.role === 'assistant' &&
			(msg.content.startsWith('{ "high_level_keywords"') ||
				msg.content.startsWith("{'high_level_keywords'"))
		) {
			continue;
		}
		messages.push(msg);
	}

	// Then process messages in chronological order
	let i = 0;
	while (i < messages.length - 1) {
		const msg1 = messages[i];
		const msg2 = messages[i + 1];

		// Check if we have a user-assistant or assistant-user pair
		if (
			(msg1.role === 'user' && msg2.role === 'assistant') ||
			(msg1.role === 'assistant' && msg2.role === 'user')
		) {
			// Always put user message first in the turn
			const turn =
				msg1.role === 'assistant'
					? [msg2, msg1] // user, assistant
					: [msg1, msg2]; // user, assistant
			turns.push(turn);
		}
		i += 2;
	}

	// Keep only the most recent numTurns
	const recentTurns = turns.length > numTurns ? turns.slice(-numTurns) : turns;

	// Format the turns into a string
	const formattedTurns: string[] = [];
	for (const turn of recentTurns) {
		formattedTurns.push(
			`user: ${turn[0].content}`,
			`assistant: ${turn[1].content}`,
		);
	}

	return formattedTurns.join('\n');
}

export function csvStringToList(csvString: string): string[][] {
	// Clean the string by removing NUL characters
	const cleanedString = csvString.replace(/\0/g, '');

	// Use PapaParse library for CSV parsing (common in TypeScript/JavaScript)
	// If you don't want to use a library, you would need a more complex custom parser

	try {
		// This is using PapaParse syntax
		const result = Papa.parse(cleanedString, {
			delimiter: ',',
			quoteChar: '"',
			escapeChar: '\\',
			skipEmptyLines: false,
		});

		return result.data as string[][];
	} catch (e) {
		throw new Error(`Failed to parse CSV string: ${e}`);
	}
}

export function processCombineContexts(hl: string, ll: string): string {
	let header: string[] | null = null;
	const listHl = csvStringToList(hl.trim());
	const listLl = csvStringToList(ll.trim());

	if (listHl.length > 0) {
		header = listHl[0];
		listHl.splice(0, 1); // Remove header
	}

	if (listLl.length > 0) {
		header = listLl[0];
		listLl.splice(0, 1); // Remove header
	}

	if (header === null) {
		return '';
	}

	let processedListHl: string[] = [];
	if (listHl.length > 0) {
		processedListHl = listHl
			.filter((item) => item.length > 0)
			.map((item) => item.slice(1).join(','));
	}

	let processedListLl: string[] = [];
	if (listLl.length > 0) {
		processedListLl = listLl
			.filter((item) => item.length > 0)
			.map((item) => item.slice(1).join(','));
	}

	const combinedSources: string[] = [];
	const seen = new Set<string>();

	// Combine and deduplicate
	for (const item of [...processedListHl, ...processedListLl]) {
		if (item && !seen.has(item)) {
			combinedSources.push(item);
			seen.add(item);
		}
	}

	const combinedSourcesResult: string[] = [header.join(',\t')];

	// Add numbered items
	combinedSources.forEach((item, index) => {
		combinedSourcesResult.push(`${index + 1},\t${item}`);
	});

	return combinedSourcesResult.join('\n');
}

export function truncateListByTokenSize<T>(
	listData: T[],
	key: (item: T) => string,
	maxTokenSize: number,
): T[] {
	if (maxTokenSize <= 0) {
		return [];
	}

	let tokens = 0;
	for (let i = 0; i < listData.length; i++) {
		tokens += encodeStringByTiktoken(key(listData[i])).length;
		if (tokens > maxTokenSize) {
			return listData.slice(0, i);
		}
	}

	return listData;
}

export function listOfListToCsv(data: string[][]): string {
	return stringify(data, {
		quoted: true,
		escape: '\\',
		quoted_empty: true,
		record_delimiter: '\n',
	});
}
