import {
	BaseGraphStorage,
	BaseKVStorage,
	BaseVectorStorage,
	QueryParam,
	TextChunkSchema,
} from '../base';
import {
	splitStringByMultiMarkers,
	listOfListToCsv,
	truncateListByTokenSize,
} from '../utils';

export async function _getEdgeData(
	query: string,
	knowledgeGraphInst: BaseGraphStorage,
	relationshipsVdb: BaseVectorStorage,
	textChunksDb: BaseKVStorage,
	queryParam: QueryParam,
): Promise<[string, string, string]> {
	console.log(
		`Query edges:  top_k: ${queryParam.top_k}, cosine: ${relationshipsVdb.cosine_better_than_threshold}`,
	);

	console.log('query', query);
	const results = await relationshipsVdb.query(
		query,
		queryParam.top_k,
		queryParam.ids,
	);
	console.log('results', results);

	if (!results.length) {
		return ['', '', ''];
	}

	// Instead of asyncio.gather, we use Promise.all
	const [edgeDatasRaw, edgeDegree] = await Promise.all([
		Promise.all(
			results.map((r) => knowledgeGraphInst.getEdge(r['src_id'], r['tgt_id'])),
		),
		Promise.all(
			results.map((r) =>
				knowledgeGraphInst.edgeDegree(r['src_id'], r['tgt_id']),
			),
		),
	]);

	let edgeDatas = results
		.map((k, idx) => {
			const v = edgeDatasRaw[idx];
			const d = edgeDegree[idx];
			if (v == null) {
				return null;
			}
			return {
				src_id: k['src_id'],
				tgt_id: k['tgt_id'],
				rank: d,
				created_at: k['__created_at__'] || null,
				...v,
			};
		})
		.filter((item) => item !== null) as Array<{
		src_id: string;
		tgt_id: string;
		rank: number;
		created_at: number | string | null;
		weight?: number;
		description?: string;
		keywords?: string[];
		[key: string]: any;
	}>;

	// Sort by rank desc, then weight desc
	edgeDatas = edgeDatas.sort((a, b) => {
		// if rank is the same, compare weight
		if (b.rank === a.rank) {
			return (b.weight || 0) - (a.weight || 0);
		}
		return b.rank - a.rank;
	});

	// Truncate by token size
	edgeDatas = truncateListByTokenSize(
		edgeDatas,
		(x) => (x.description ? x.description : ''),
		queryParam.max_token_for_global_context,
	);

	// Retrieve relevant entities and text chunks
	const [useEntities, useTextUnits] = await Promise.all([
		_findMostRelatedEntitiesFromRelationships(
			edgeDatas,
			queryParam,
			knowledgeGraphInst,
		),
		_findRelatedTextUnitFromRelationships(edgeDatas, queryParam, textChunksDb),
	]);

	console.log(
		`Global query uses ${useEntities.length} entites, ${edgeDatas.length} relations, ${useTextUnits.length} chunks`,
	);

	// Build CSV for relations
	const relationsSectionList: any[][] = [
		[
			'id',
			'source',
			'target',
			'description',
			'keywords',
			'weight',
			'rank',
			'created_at',
		],
	];

	edgeDatas.forEach((e, i) => {
		let createdAt: number | string | null = e.created_at ?? 'Unknown';
		if (typeof createdAt === 'number') {
			const dateObj = new Date(createdAt * 1000); // if seconds
			createdAt = dateObj.toISOString().replace('T', ' ').split('.')[0];
		}
		relationsSectionList.push([
			i,
			e.src_id,
			e.tgt_id,
			e.description,
			e.keywords,
			e.weight,
			e.rank,
			createdAt,
		]);
	});
	const relationsContext = listOfListToCsv(relationsSectionList);

	// Build CSV for entities
	const entitiesSectionList: any[][] = [
		['id', 'entity', 'type', 'description', 'rank'],
	];
	useEntities.forEach((n, i) => {
		let createdAt: number | string | null = n['created_at'] ?? 'Unknown';
		if (typeof createdAt === 'number') {
			const dateObj = new Date(createdAt * 1000);
			createdAt = dateObj.toISOString().replace('T', ' ').split('.')[0];
		}
		entitiesSectionList.push([
			i,
			n['entity_name'],
			n['entity_type'] || 'UNKNOWN',
			n['description'] || 'UNKNOWN',
			n['rank'],
			createdAt,
		]);
	});
	const entitiesContext = listOfListToCsv(entitiesSectionList);

	// Build CSV for text units
	const textUnitsSectionList: any[][] = [['id', 'content']];
	useTextUnits.forEach((t, i) => {
		textUnitsSectionList.push([i, t.content]);
	});
	const textUnitsContext = listOfListToCsv(textUnitsSectionList);

	return [entitiesContext, relationsContext, textUnitsContext];
}

export async function _findMostRelatedEntitiesFromRelationships(
	edgeDatas: Array<{
		src_id: string;
		tgt_id: string;
		rank?: number;
		[key: string]: any;
	}>,
	queryParam: QueryParam,
	knowledgeGraphInst: BaseGraphStorage,
): Promise<Array<{ [key: string]: any }>> {
	const entityNames: string[] = [];
	const seen = new Set<string>();

	edgeDatas.forEach((e) => {
		if (!seen.has(e.src_id)) {
			entityNames.push(e.src_id);
			seen.add(e.src_id);
		}
		if (!seen.has(e.tgt_id)) {
			entityNames.push(e.tgt_id);
			seen.add(e.tgt_id);
		}
	});

	const [nodeDatasRaw, nodeDegrees] = await Promise.all([
		Promise.all(entityNames.map((name) => knowledgeGraphInst.getNode(name))),
		Promise.all(entityNames.map((name) => knowledgeGraphInst.nodeDegree(name))),
	]);

	let nodeDatas = nodeDatasRaw.map((n, idx) => {
		return {
			...n,
			description: n.description || '',
			entity_name: entityNames[idx],
			rank: nodeDegrees[idx],
		};
	});

	const lenNodeDatas = nodeDatas.length;
	nodeDatas = truncateListByTokenSize(
		nodeDatas,
		(x) => (x.description ? x.description : ''),
		queryParam.max_token_for_local_context,
	);
	console.debug(
		`Truncate entities from ${lenNodeDatas} to ${nodeDatas.length} (max tokens:${queryParam.max_token_for_local_context})`,
	);

	return nodeDatas;
}

export async function _findRelatedTextUnitFromRelationships(
	edgeDatas: Array<{
		source_id?: string;
		[key: string]: any;
	}>,
	queryParam: QueryParam,
	textChunksDb: BaseKVStorage,
): Promise<TextChunkSchema[]> {
	// source_id is something like "id1|id2" => we split by some marker
	const textUnitsArrays = edgeDatas.map((dp) =>
		splitStringByMultiMarkers(
			dp['source_id'] || '',
			['|'] /* or GRAPH_FIELD_SEP if you prefer */,
		),
	);

	const allTextUnitsLookup: { [key: string]: { data: any; order: number } } = {};

	async function fetchChunkData(cId: string, index: number) {
		if (!(cId in allTextUnitsLookup)) {
			const chunkData = await textChunksDb.getById(cId);
			if (chunkData && chunkData.content) {
				allTextUnitsLookup[cId] = {
					data: chunkData,
					order: index,
				};
			}
		}
	}

	const tasks: Array<Promise<void>> = [];
	textUnitsArrays.forEach((unitList, index) => {
		unitList.forEach((cId) => {
			tasks.push(fetchChunkData(cId, index));
		});
	});

	await Promise.all(tasks);

	const allTextUnitEntries = Object.entries(allTextUnitsLookup);
	if (!allTextUnitEntries.length) {
		console.warn('No valid text chunks found');
		return [];
	}

	// Flatten to an array
	let allTextUnits = allTextUnitEntries.map(([key, value]) => {
		return {
			id: key,
			...value,
		};
	});

	// Sort by `order`
	allTextUnits = allTextUnits.sort((a, b) => a.order - b.order);

	// Filter out invalid data
	const validTextUnits = allTextUnits.filter((t) => t.data && t.data.content);

	if (!validTextUnits.length) {
		console.warn('No valid text chunks after filtering');
		return [];
	}

	// Truncate
	const truncatedTextUnits = truncateListByTokenSize(
		validTextUnits,
		(x) => x.data.content,
		queryParam.max_token_for_text_unit,
	);
	console.debug(
		`Truncate chunks from ${validTextUnits.length} to ${truncatedTextUnits.length} (max tokens:${queryParam.max_token_for_text_unit})`,
	);

	const finalTextUnits = truncatedTextUnits.map((t) => t.data as TextChunkSchema);
	return finalTextUnits;
}
