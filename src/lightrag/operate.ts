import { encoding_for_model } from 'tiktoken';

interface ChunkData {
	tokens: number;
	content: string;
	chunk_order_index: number;
}

export function chunkingByTokenSize(
	content: string,
	splitByCharacter: string | null = null,
	splitByCharacterOnly: boolean = false,
	overlapTokenSize: number = 128,
	maxTokenSize: number = 1024,
): ChunkData[] {
	console.log('chunkingByTokenSize', {
		splitByCharacter,
		splitByCharacterOnly,
		overlapTokenSize,
		maxTokenSize,
	});
	const tokens = encodeStringByTiktoken(content);
	console.log('tokens', tokens);
	const results: ChunkData[] = [];

	if (splitByCharacter) {
		const rawChunks = content.split(splitByCharacter);
		const newChunks: [number, string][] = [];

		if (splitByCharacterOnly) {
			for (const chunk of rawChunks) {
				const _tokens = encodeStringByTiktoken(chunk);
				newChunks.push([_tokens.length, chunk]);
			}
		} else {
			for (const chunk of rawChunks) {
				const _tokens = encodeStringByTiktoken(chunk);
				if (_tokens.length > maxTokenSize) {
					for (
						let start = 0;
						start < _tokens.length;
						start += maxTokenSize - overlapTokenSize
					) {
						const chunkContent = decodeTokensByTiktoken(
							_tokens.slice(start, start + maxTokenSize),
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
			);
			console.log('chunkContent', chunkContent?.slice(0, 10));
			results.push({
				tokens: Math.min(maxTokenSize, tokens.length - start),
				content: chunkContent.trim(),
				chunk_order_index: index,
			});
		}
	}

	return results;
}

export function encodeStringByTiktoken(content: string): number[] {
	const encoder = encoding_for_model('gpt-4o-mini');
	const tokens = encoder.encode(content);
	return Array.from(tokens);
}

export function decodeTokensByTiktoken(tokens: number[]): string {
	const encoder = encoding_for_model('gpt-4o-mini');
	const content = new TextDecoder().decode(
		encoder.decode(new Uint32Array(tokens)),
	);
	return content;
}
