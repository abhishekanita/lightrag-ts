import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import dotenv from 'dotenv';
import winston from 'winston';
import { stringify } from 'csv-stringify/sync';
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { PROMPTS } from './prompt';
import { STORAGE_ENV_REQUIREMENTS } from './kg';

// Load environment variables
dotenv.config({ override: true });

// Numpy alternative for TypeScript
// import { Matrix, SingularValueDecomposition } from 'ml-matrix';

// Global variables
let VERBOSE_DEBUG = process.env.VERBOSE?.toLowerCase() === 'true';

// Initialize logger
const logger = winston.createLogger({
	level: process.env.LOG_LEVEL || 'info',
	format: winston.format.combine(
		winston.format.timestamp(),
		winston.format.printf(({ level, message, timestamp }) => {
			return `${timestamp} - lightrag - ${level}: ${message}`;
		}),
	),
	transports: [
		new winston.transports.Console({
			format: winston.format.simple(),
		}),
	],
});

// Statistics

/**
 * Function for outputting detailed debug information.
 * When VERBOSE_DEBUG=true, outputs the complete message.
 * When VERBOSE_DEBUG=false, outputs only the first 50 characters.
 */
export function verboseDebug(msg: string, ...args: any[]): void {
	if (VERBOSE_DEBUG) {
		logger.debug(msg, ...args);
	} else {
		// Format the message with args first
		let formattedMsg = msg;
		if (args.length > 0) {
			// Simple string formatting (not as robust as Python's %)
			args.forEach((arg, i) => {
				formattedMsg = formattedMsg.replace(`%s`, String(arg));
			});
		}
		// Then truncate the formatted message
		const truncatedMsg =
			formattedMsg.length > 50
				? formattedMsg.substring(0, 50) + '...'
				: formattedMsg;
		logger.debug(truncatedMsg);
	}
}

/**
 * Enable or disable verbose debug output
 */
export function setVerboseDebug(enabled: boolean): void {
	VERBOSE_DEBUG = enabled;
}

/**
 * Filter for lightrag logger to filter out frequent path access logs
 */
class LightragPathFilter {
	private filteredPaths: string[];

	constructor() {
		// Define paths to be filtered
		this.filteredPaths = ['/documents', '/health', '/webui/'];
	}

	filter(info: any): boolean {
		try {
			// Check if record has the required attributes for an access log
			if (!info.args || !Array.isArray(info.args)) {
				return true;
			}
			if (info.args.length < 5) {
				return true;
			}

			// Extract method, path and status from the record args
			const method = info.args[1];
			const path = info.args[2];
			const status = info.args[4];

			// Filter out successful GET requests to filtered paths
			if (
				method === 'GET' &&
				(status === 200 || status === 304) &&
				this.filteredPaths.includes(path)
			) {
				return false;
			}

			return true;
		} catch (error) {
			// In case of any error, let the message through
			return true;
		}
	}
}

/**
 * Set up a logger with console and file handlers
 */
export function setupLogger(
	loggerName: string,
	level: string = 'INFO',
	addFilter: boolean = false,
	logFilePath?: string,
): void {
	// Configure formatters
	const detailedFormat = winston.format.combine(
		winston.format.timestamp(),
		winston.format.printf(({ level, message, timestamp }) => {
			return `${timestamp} - ${loggerName} - ${level}: ${message}`;
		}),
	);

	const simpleFormat = winston.format.printf(({ level, message }) => {
		return `${level}: ${message}`;
	});

	// Get log file path
	if (!logFilePath) {
		const logDir = process.env.LOG_DIR || process.cwd();
		logFilePath = path.resolve(logDir, 'lightrag.log');
	}

	// Ensure log directory exists
	fs.mkdirSync(path.dirname(logFilePath), { recursive: true });

	// Get log file max size and backup count from environment variables
	const logMaxBytes = parseInt(process.env.LOG_MAX_BYTES || '10485760', 10); // Default 10MB
	const logBackupCount = parseInt(process.env.LOG_BACKUP_COUNT || '5', 10); // Default 5 backups

	// Create new logger instance
	const loggerInstance = winston.createLogger({
		level: level.toLowerCase(),
		format: detailedFormat,
		transports: [
			// Console transport
			new winston.transports.Console({
				format: simpleFormat,
			}),
			// File transport
			new winston.transports.File({
				filename: logFilePath,
				maxsize: logMaxBytes,
				maxFiles: logBackupCount,
			}),
		],
	});

	// Add path filter if requested
	if (addFilter) {
		const pathFilter = new LightragPathFilter();
		// In Winston, we apply filters to transports
		loggerInstance.transports.forEach((transport) => {
			transport.format = winston.format.combine(
				winston.format((info) => (pathFilter.filter(info) ? info : false))(),
				transport.format || winston.format.simple(),
			);
		});
	}

	// Replace the default logger with our configured one
	Object.assign(logger, loggerInstance);
}

/**
 * A context manager that allows unlimited access
 */
export class UnlimitedSemaphore {
	async acquire(): Promise<void> {
		// Do nothing
	}

	async release(): Promise<void> {
		// Do nothing
	}
}

// Tiktoken encoder equivalent (simplified)
const ENCODER: any = null;

/**
 * Embedding function class
 */
export interface EmbeddingFunc {
	call: (...args: any[]) => Promise<number[][]>;
}

/**
 * Locate the JSON string body from a string
 */
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

/**
 * Convert response to JSON
 */
export function convertResponseToJson(response: string): Record<string, any> {
	const jsonStr = locateJsonStringBodyFromString(response);
	if (!jsonStr) {
		throw new Error(`Unable to parse JSON from response: ${response}`);
	}

	try {
		const data = JSON.parse(jsonStr);
		return data;
	} catch (e) {
		logger.error(`Failed to parse JSON: ${jsonStr}`);
		throw e;
	}
}

/**
 * Compute a hash for the given arguments
 */

/**
 * Compute a unique ID for a given content string
 */
export function computeMdHashId(content: string, prefix: string = ''): string {
	return prefix + createHash('md5').update(content).digest('hex');
}

/**
 * Add restriction of maximum concurrent async calls using semaphore
 */
export function limitAsyncFuncCall(maxSize: number) {
	return function decorator<T extends (...args: any[]) => Promise<any>>(
		func: T,
	): T {
		// Create a semaphore-like mechanism using a counter and a queue
		let currentCount = 0;
		const queue: Array<() => void> = [];

		const acquire = async () => {
			if (currentCount < maxSize) {
				currentCount++;
				return;
			}

			return new Promise<void>((resolve) => {
				queue.push(resolve);
			});
		};

		const release = () => {
			if (queue.length > 0) {
				const resolve = queue.shift()!;
				resolve();
			} else {
				currentCount--;
			}
		};

		const wrappedFunc = async (
			...args: Parameters<T>
		): Promise<ReturnType<T>> => {
			await acquire();
			try {
				return await func(...args);
			} finally {
				release();
			}
		};

		return wrappedFunc as T;
	};
}

/**
 * Wrap an embedding function with attributes
 */
export function wrapEmbeddingFuncWithAttrs(options: {
	embedding_dim: number;
	max_token_size: number;
}) {
	return function decorator<T extends (...args: any[]) => Promise<number[][]>>(
		func: T,
	): EmbeddingFunc {
		return new EmbeddingFunc(
			options.embedding_dim,
			options.max_token_size,
			func,
		);
	};
}

/**
 * Load JSON from a file
 */
export function loadJson(fileName: string): any {
	if (!fs.existsSync(fileName)) {
		return null;
	}
	const fileContent = fs.readFileSync(fileName, 'utf-8');
	return JSON.parse(fileContent);
}

/**
 * Write JSON to a file
 */
export function writeJson(jsonObj: any, fileName: string): void {
	fs.writeFileSync(fileName, JSON.stringify(jsonObj, null, 2), {
		encoding: 'utf-8',
	});
}

/**
 * Encode string by tiktoken-like tokenizer
 * Note: This is a placeholder - a proper tokenizer implementation would be required
 */
export function encodeStringByTiktoken(
	content: string,
	modelName: string = 'gpt-4o',
): number[] {
	// In a real implementation, you would integrate with a tokenizer like GPT-Tokenizer or similar
	// For now, we'll use a simple approximation
	const tokens: number[] = [];
	const words = content.split(/\s+/);

	// Very crude approximation - in a real implementation use a proper tokenizer
	for (let i = 0; i < words.length; i++) {
		const word = words[i];
		// Generate some fake token IDs based on the characters
		for (let j = 0; j < word.length; j += 4) {
			const chunk = word.substring(j, Math.min(j + 4, word.length));
			let tokenId = 0;
			for (let k = 0; k < chunk.length; k++) {
				tokenId = (tokenId * 256 + chunk.charCodeAt(k)) % 50000;
			}
			tokens.push(tokenId);
		}
	}

	return tokens;
}

/**
 * Decode tokens by tiktoken-like tokenizer
 */
export function decodeTokensByTiktoken(
	tokens: number[],
	modelName: string = 'gpt-4o',
): string {
	// Placeholder for a real tokenizer implementation
	return tokens.map((t) => String.fromCharCode(t % 256)).join('');
}

/**
 * Pack user/assistant messages to OpenAI-format messages
 */

/**
 * Clean an input string by removing HTML escapes, control characters, and other unwanted characters
 */

/**
 * Check if a string is a float using regex
 */

/**
 * Truncate a list by token size
 */

/**
 * Convert a list of lists to CSV string
 */

/**
 * Convert a CSV string to a list of lists
 */
export function csvStringToList(csvString: string): string[][] {
	// Clean the string by removing NUL characters
	const cleanedString = csvString.replace(/\0/g, '');

	const result: string[][] = [];
	let inQuote = false;
	let currentField = '';
	let currentRow: string[] = [];

	for (let i = 0; i < cleanedString.length; i++) {
		const char = cleanedString[i];
		const nextChar = i < cleanedString.length - 1 ? cleanedString[i + 1] : '';

		if (char === '"' && !inQuote) {
			inQuote = true;
		} else if (char === '"' && inQuote) {
			if (nextChar === '"') {
				// Double quote inside quoted field
				currentField += '"';
				i++; // Skip next quote
			} else {
				inQuote = false;
			}
		} else if (char === ',' && !inQuote) {
			currentRow.push(currentField);
			currentField = '';
		} else if ((char === '\n' || char === '\r') && !inQuote) {
			if (char === '\r' && nextChar === '\n') {
				i++; // Skip \n in \r\n
			}
			if (currentField !== '' || currentRow.length > 0) {
				currentRow.push(currentField);
				result.push(currentRow);
				currentRow = [];
				currentField = '';
			}
		} else {
			currentField += char;
		}
	}

	// Handle last row if needed
	if (currentField !== '' || currentRow.length > 0) {
		currentRow.push(currentField);
		result.push(currentRow);
	}

	return result;
}

/**
 * Save data to a file
 */
export function saveDataToFile(data: any, fileName: string): void {
	fs.writeFileSync(fileName, JSON.stringify(data, null, 4), { encoding: 'utf-8' });
}

/**
 * Convert XML to JSON
 */
export function xmlToJson(xmlFile: string): any {
	try {
		const xmlContent = fs.readFileSync(xmlFile, 'utf-8');
		const parser = new XMLParser({
			ignoreAttributes: false,
			attributeNamePrefix: '',
			parseAttributeValue: true,
		});

		const jsonData = parser.parse(xmlContent);

		// Extract root element
		const rootElement = Object.keys(jsonData)[0];
		console.log(`Root element: ${rootElement}`);
		console.log(`Root attributes: ${JSON.stringify(jsonData[rootElement][''])}`);

		const result = { nodes: [], edges: [] };

		// Process nodes
		const graphmlNs = 'http://graphml.graphdrawing.org/xmlns';
		const nodes = jsonData[rootElement].graph?.node || [];
		const edges = jsonData[rootElement].graph?.edge || [];

		if (Array.isArray(nodes)) {
			for (const node of nodes) {
				const nodeData = {
					id: node.id?.toString().replace(/"/g, ''),
					entity_type:
						node.data
							?.find((d: any) => d.key === 'd0')
							?.['#text']?.replace(/"/g, '') || '',
					description:
						node.data?.find((d: any) => d.key === 'd1')?.['#text'] || '',
					source_id:
						node.data?.find((d: any) => d.key === 'd2')?.['#text'] || '',
				};
				result.nodes.push(nodeData);
			}
		}

		// Process edges
		if (Array.isArray(edges)) {
			for (const edge of edges) {
				const edgeData = {
					source: edge.source?.toString().replace(/"/g, ''),
					target: edge.target?.toString().replace(/"/g, ''),
					weight: parseFloat(
						edge.data?.find((d: any) => d.key === 'd3')?.['#text'] ||
							'0',
					),
					description:
						edge.data?.find((d: any) => d.key === 'd4')?.['#text'] || '',
					keywords:
						edge.data?.find((d: any) => d.key === 'd5')?.['#text'] || '',
					source_id:
						edge.data?.find((d: any) => d.key === 'd6')?.['#text'] || '',
				};
				result.edges.push(edgeData);
			}
		}

		console.log(
			`Found ${result.nodes.length} nodes and ${result.edges.length} edges`,
		);

		return result;
	} catch (error) {
		console.error(`Error parsing XML file: ${error}`);
		return null;
	}
}

/**
 * Process and combine contexts
 */
export function processCombineContexts(hl: string, ll: string): string {
	let header = null;
	const listHl = csvStringToList(hl.trim());
	const listLl = csvStringToList(ll.trim());

	if (listHl.length) {
		header = listHl[0];
		listHl.shift(); // Remove header
	}

	if (listLl.length) {
		header = listLl[0];
		listLl.shift(); // Remove header
	}

	if (!header) {
		return '';
	}

	const hlItems = listHl.length
		? listHl.map((item) => item.slice(1).join(','))
		: [];
	const llItems = listLl.length
		? listLl.map((item) => item.slice(1).join(','))
		: [];

	const combinedSources: string[] = [];
	const seen = new Set<string>();

	// Combine and deduplicate
	for (const item of [...hlItems, ...llItems]) {
		if (item && !seen.has(item)) {
			combinedSources.push(item);
			seen.add(item);
		}
	}

	// Format the result
	const combinedSourcesResult = [header.join(',\t')];

	combinedSources.forEach((item, i) => {
		combinedSourcesResult.push(`${i + 1},\t${item}`);
	});

	return combinedSourcesResult.join('\n');
}

/**
 * Data class for cache data
 */

/**
 * Calculate cosine similarity between two vectors
 */

/**
 * Quantize embedding to specified bits
 */

/**
 * Restore quantized embedding
 */

export function checkStorageEnvVars(storageName: string): void {
	const required_vars = STORAGE_ENV_REQUIREMENTS[storageName];
	const missing_vars = required_vars.filter((name) => {
		const value = process.env[name];
		if (!value) {
			return true;
		}
		return false;
	});
	if (missing_vars.length > 0) {
		throw new Error(
			`Storage implementation '${storageName}' requires the following ` +
				`environment variables: ${missing_vars.join(', ')}`,
		);
	}
}
