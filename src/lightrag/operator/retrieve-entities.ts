import {
	BaseGraphStorage,
	BaseKVStorage,
	BaseVectorStorage,
	QueryParam,
} from '../base';
import { GRAPH_FIELD_SEP } from '../prompt';
import {
	splitStringByMultiMarkers,
	listOfListToCsv,
	truncateListByTokenSize,
} from '../utils';

export async function _getNodeData(
	query: string,
	knowledgeGraphInst: BaseGraphStorage,
	entitiesVdb: BaseVectorStorage,
	textChunksDb: BaseKVStorage,
	queryParam: QueryParam,
): Promise<[string, string, string]> {
	// Get similar entities
	console.info(
		`Query nodes: ${query}, top_k: ${queryParam.top_k}, cosine: ${entitiesVdb.cosine_better_than_threshold}`,
	);

	const results = await entitiesVdb.query(query, queryParam.top_k, queryParam.ids);
	console.log('results', results);

	if (results.length === 0) {
		return ['', '', ''];
	}

	// Get entity information
	const nodeDataPromises = results.map((r) =>
		knowledgeGraphInst.getNode(r.entity_name),
	);
	const nodeDegreePromises = results.map((r) =>
		knowledgeGraphInst.nodeDegree(r.entity_name),
	);

	const [nodeDatas, nodeDegrees] = await Promise.all([
		Promise.all(nodeDataPromises),
		Promise.all(nodeDegreePromises),
	]);

	if (!nodeDatas.every((n) => n !== null)) {
		console.warn('Some nodes are missing, maybe the storage is damaged');
	}

	const nodeDatasList = nodeDatas
		.map((n, i) => {
			if (n === null) return null;
			return {
				...n,
				entity_name: results[i].entity_name,
				rank: nodeDegrees[i],
				description: results[i].description,
				entity_type: results[i].entity_type,
				createdAt: results[i].createdAt,
			};
		})
		.filter((n) => n !== null);

	// Get entity text chunk and relations
	const [useTextUnits, useRelations] = await Promise.all([
		_findMostRelatedTextUnitFromEntities(
			nodeDatasList,
			queryParam,
			textChunksDb,
			knowledgeGraphInst,
		),
		_findMostRelatedEdgesFromEntities(
			nodeDatasList,
			queryParam,
			knowledgeGraphInst,
		),
	]);

	const lenNodeDatas = nodeDatasList.length;
	const truncatedNodeDatas = truncateListByTokenSize(
		nodeDatasList,
		(x) => x.description || '',
		queryParam.max_token_for_local_context,
	);

	console.debug(
		`Truncate entities from ${lenNodeDatas} to ${truncatedNodeDatas.length} (max tokens:${queryParam.max_token_for_local_context})`,
	);

	console.info(
		`Local query uses ${truncatedNodeDatas.length} entities, ${useRelations.length} relations, ${useTextUnits.length} chunks`,
	);

	// Build prompt
	const entitesSectionList = [
		['id', 'entity', 'type', 'description', 'rank', 'created_at'],
	];

	for (let i = 0; i < truncatedNodeDatas.length; i++) {
		const n = truncatedNodeDatas[i];
		let createdAt = n.createdAt || 'UNKNOWN';
		if (typeof createdAt === 'number') {
			createdAt = new Date(createdAt * 1000)
				.toISOString()
				.replace('T', ' ')
				.substr(0, 19);
		}

		entitesSectionList.push([
			i,
			n.entity_name,
			n.entity_type || 'UNKNOWN',
			n.description || 'UNKNOWN',
			n.rank,
			createdAt,
		]);
	}

	const entitiesContext = listOfListToCsv(entitesSectionList);

	const relationsSectionList = [
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

	for (let i = 0; i < useRelations.length; i++) {
		const e = useRelations[i];
		let createdAt = e.created_at || 'UNKNOWN';
		// Convert timestamp to readable format
		if (typeof createdAt === 'number') {
			createdAt = new Date(createdAt * 1000)
				.toISOString()
				.replace('T', ' ')
				.substr(0, 19);
		}

		relationsSectionList.push([
			i,
			e.src_tgt[0],
			e.src_tgt[1],
			e.description,
			e.keywords,
			e.weight,
			e.rank,
			createdAt,
		]);
	}

	const relationsContext = listOfListToCsv(relationsSectionList);

	const textUnitsSectionList = [['id', 'content']];
	for (let i = 0; i < useTextUnits.length; i++) {
		textUnitsSectionList.push([i, useTextUnits[i].content]);
	}

	const textUnitsContext = listOfListToCsv(textUnitsSectionList);

	return [entitiesContext, relationsContext, textUnitsContext];
}

async function _findMostRelatedTextUnitFromEntities(
	nodeDatas: any[],
	queryParam: QueryParam,
	textChunksDb: BaseKVStorage,
	knowledgeGraphInst: BaseGraphStorage,
): Promise<any[]> {
	const textUnits = nodeDatas.map((dp) =>
		splitStringByMultiMarkers(dp.source_id, [GRAPH_FIELD_SEP]),
	);

	const edges = await Promise.all(
		nodeDatas.map((dp) => knowledgeGraphInst.getNodeEdges(dp.entity_name)),
	);

	const allOneHopNodes = new Set<string>();
	for (const thisEdges of edges) {
		if (!thisEdges || !thisEdges.length) continue;
		for (const e of thisEdges) {
			allOneHopNodes.add(e[1]);
		}
	}

	const allOneHopNodesArray = Array.from(allOneHopNodes);
	const allOneHopNodesData = await Promise.all(
		allOneHopNodesArray.map((e) => knowledgeGraphInst.getNode(e)),
	);

	// Add null check for node data
	const allOneHopTextUnitsLookup: Record<string, Set<string>> = {};
	for (let i = 0; i < allOneHopNodesArray.length; i++) {
		const node = allOneHopNodesData[i];
		if (node !== null && node.source_id) {
			allOneHopTextUnitsLookup[allOneHopNodesArray[i]] = new Set(
				splitStringByMultiMarkers(node.source_id, [GRAPH_FIELD_SEP]),
			);
		}
	}

	const allTextUnitsLookup: Record<string, any> = {};
	const tasks: [string, number, any[]][] = [];

	for (let index = 0; index < textUnits.length; index++) {
		const thisTextUnits = textUnits[index];
		const thisEdges = edges[index];

		for (const cId of thisTextUnits) {
			if (!(cId in allTextUnitsLookup)) {
				allTextUnitsLookup[cId] = index;
				tasks.push([cId, index, thisEdges]);
			}
		}
	}

	const results = await Promise.all(
		tasks.map(([cId]) => textChunksDb.getById(cId)),
	);

	for (let i = 0; i < tasks.length; i++) {
		const [cId, index, thisEdges] = tasks[i];
		const data = results[i];

		allTextUnitsLookup[cId] = {
			data,
			order: index,
			relation_counts: 0,
		};

		if (thisEdges && thisEdges.length) {
			for (const e of thisEdges) {
				if (
					e[1] in allOneHopTextUnitsLookup &&
					allOneHopTextUnitsLookup[e[1]].has(cId)
				) {
					allTextUnitsLookup[cId].relation_counts += 1;
				}
			}
		}
	}

	// Filter out null values and ensure data has content
	const allTextUnits = Object.entries(allTextUnitsLookup)
		.filter(
			([_, v]) =>
				v !== null &&
				v.data !== null &&
				typeof v.data === 'object' &&
				'content' in v.data,
		)
		.map(([k, v]) => ({ id: k, ...v }));

	if (!allTextUnits.length) {
		console.warn('No valid text units found');
		return [];
	}

	allTextUnits.sort((a, b) => {
		if (a.order !== b.order) return a.order - b.order;
		return b.relation_counts - a.relation_counts;
	});

	const truncatedTextUnits = truncateListByTokenSize(
		allTextUnits,
		(x) => x.data.content,
		queryParam.max_token_for_text_unit,
	);

	console.debug(
		`Truncate chunks from ${Object.keys(allTextUnitsLookup).length} to ${truncatedTextUnits.length} (max tokens:${queryParam.max_token_for_text_unit})`,
	);

	return truncatedTextUnits.map((t) => t.data);
}

async function _findMostRelatedEdgesFromEntities(
	nodeDatas: any[],
	queryParam: QueryParam,
	knowledgeGraphInst: BaseGraphStorage,
): Promise<any[]> {
	const allRelatedEdges = await Promise.all(
		nodeDatas.map((dp) => knowledgeGraphInst.getNodeEdges(dp.entity_name)),
	);

	const allEdges: [string, string][] = [];
	const seen = new Set<string>();

	for (const thisEdges of allRelatedEdges) {
		if (!thisEdges) continue;

		for (const e of thisEdges) {
			const sortedEdge = [e[0], e[1]].sort().join(':');
			if (!seen.has(sortedEdge)) {
				seen.add(sortedEdge);
				allEdges.push([e[0], e[1]]);
			}
		}
	}

	const allEdgesPack = await Promise.all(
		allEdges.map((e) => knowledgeGraphInst.getEdge(e[0], e[1])),
	);

	const allEdgesDegree = await Promise.all(
		allEdges.map((e) => knowledgeGraphInst.edgeDegree(e[0], e[1])),
	);

	const allEdgesData = allEdges
		.map((k, i) => {
			const v = allEdgesPack[i];
			const d = allEdgesDegree[i];
			if (v === null) return null;
			return {
				src_tgt: k,
				rank: d,
				description: v.description,
				weight: +v.weight,
				...v,
			};
		})
		.filter((x) => x !== null)
		.sort((a, b) => {
			if (b.rank !== a.rank) return b.rank - a.rank;
			return b.weight - a.weight;
		});

	const truncatedEdgesData = truncateListByTokenSize(
		allEdgesData,
		(x) => x.description || '',
		queryParam.max_token_for_global_context,
	);

	console.debug(
		`Truncate relations from ${allEdges.length} to ${truncatedEdgesData.length} (max tokens:${queryParam.max_token_for_global_context})`,
	);

	return truncatedEdgesData;
}
