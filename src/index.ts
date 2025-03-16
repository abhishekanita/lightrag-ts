import { LightRAG } from './lightrag';
import { QueryParam } from './lightrag/base';
import { openaiEmbed, gpt4oMiniComplete } from './lightrag/llm/openai';
import fs from 'fs';

const main = async () => {
	try {
		const lightrag = new LightRAG({
			workingDir: './dickens',
			embeddingFunc: openaiEmbed,
			llmModelFunc: gpt4oMiniComplete,
		});
		await lightrag.initilaize();
		await lightrag.initializeStorages();
		console.log('storage initialised');
		// await initialize_pipeline_status
		// const book = fs.readFileSync('./book.txt', 'utf8');
		// console.log('book fetched');
		// await lightrag.insertDoc(book);
		// console.log('hey');
		// lightrag.query(
		// 	'Tell me about Scrooge',
		// 	new QueryParam({
		// 		mode: 'local',
		// 	}),
		// );
	} catch (err) {
		console.log(err);
	}
};

main();
