export function quantizeEmbedding(
	embedding: number[] | Float32Array,
	bits: number = 8,
): [Uint8Array, number, number] {
	// Calculate min/max values for reconstruction
	const embedArray = Array.isArray(embedding) ? embedding : Array.from(embedding);
	const minVal = Math.min(...embedArray);
	const maxVal = Math.max(...embedArray);

	// Quantize to 0-255 range for 8-bit
	const scale = ((1 << bits) - 1) / (maxVal - minVal);
	const quantized = new Uint8Array(embedArray.length);

	for (let i = 0; i < embedArray.length; i++) {
		quantized[i] = Math.round((embedArray[i] - minVal) * scale);
	}

	return [quantized, minVal, maxVal];
}

export function dequantizeEmbedding(
	quantized: Uint8Array,
	minVal: number,
	maxVal: number,
	bits: number = 8,
): Float32Array {
	const scale = (maxVal - minVal) / ((1 << bits) - 1);
	const result = new Float32Array(quantized.length);

	for (let i = 0; i < quantized.length; i++) {
		result[i] = quantized[i] * scale + minVal;
	}

	return result;
}

export function cosineSimilarity(v1: number[], v2: number[]): number {
	if (v1.length !== v2.length) {
		throw new Error('Vectors must have the same dimension');
	}

	let dotProduct = 0;
	let norm1 = 0;
	let norm2 = 0;

	for (let i = 0; i < v1.length; i++) {
		dotProduct += v1[i] * v2[i];
		norm1 += v1[i] * v1[i];
		norm2 += v2[i] * v2[i];
	}

	norm1 = Math.sqrt(norm1);
	norm2 = Math.sqrt(norm2);

	return dotProduct / (norm1 * norm2);
}
