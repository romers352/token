import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { nodeProperties } from './Description';
import { fetchExecution } from './Transport';
import { resolveExecutionId, formatDuration } from './GenericFunctions';
import {
	validateExecutionId,
	validateExecutionData,
	validateCustomPricing,
} from './Validators';
import {
	extractNodeAnalytics,
	extractAiAnalytics,
	extractWorkflowMetadata,
	buildTimeline,
	aggregateTokens,
	calculateCost,
	filterNodes,
	toFlatJson,
	toCsv,
	toMarkdown,
	type GroupBy,
	type FilterType,
	type IAiNodeAnalytics,
	type ITokenUsage,
} from './Helpers';

type AdvancedOptions = {
	includeTokenUsage?: boolean;
	includeCosts?: boolean;
	includeErrors?: boolean;
	includeNodeTiming?: boolean;
	includeWorkflowMetadata?: boolean;
	includeAiMetadata?: boolean;
	includeRawExecution?: boolean;
};

export class Analytics implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Analytics',
		name: 'analytics',
		icon: 'file:icon.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description:
			'Analyze n8n executions: AI token usage, cost estimation, per-node stats, timelines and more',
		defaults: {
			name: 'Analytics',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'n8nApi',
				required: true,
			},
		],
		properties: nodeProperties,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const node = this.getNode();

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				const advanced = this.getNodeParameter('advancedOptions', i, {}) as AdvancedOptions;

				// Resolve & validate the execution ID, then fetch.
				const executionId = resolveExecutionId(this, i);
				validateExecutionId(executionId, node);

				const execution = await fetchExecution.call(this, executionId);
				validateExecutionData(execution, node);

				let result: IDataObject;

				switch (operation) {
					case 'analyzeExecution':
						result = handleAnalyzeExecution(execution, advanced);
						break;
					case 'tokenSummary':
						result = handleTokenSummary(this, execution, i);
						break;
					case 'workflowSummary':
						result = handleWorkflowSummary(execution);
						break;
					case 'aiModelSummary':
						result = handleAiModelSummary(execution);
						break;
					case 'costSummary':
						result = handleCostSummary(this, execution, i, node);
						break;
					case 'nodeStatistics':
						result = handleNodeStatistics(this, execution, i, advanced);
						break;
					case 'executionTimeline':
						result = handleExecutionTimeline(execution);
						break;
					case 'exportAnalytics':
						result = handleExportAnalytics(this, execution, i, advanced);
						break;
					default:
						throw new NodeOperationError(node, `Unknown operation: ${operation}`, {
							itemIndex: i,
						});
				}

				if (advanced.includeRawExecution) {
					result.rawExecution = execution;
				}

				returnData.push({ json: result, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}

/* ------------------------------------------------------------------ *
 *  Operation handlers
 * ------------------------------------------------------------------ */

function handleAnalyzeExecution(execution: any, advanced: AdvancedOptions): IDataObject {
	const metadata = extractWorkflowMetadata(execution);
	const nodes = extractNodeAnalytics(execution);
	const aiNodes = extractAiAnalytics(execution);
	const totalTokens = sumTokens(aiNodes);

	const result: IDataObject = {
		executionId: metadata.executionId,
		workflowName: metadata.workflowName,
		status: metadata.status,
		duration: formatDuration(metadata.duration_ms),
		duration_ms: metadata.duration_ms,
		nodeCount: nodes.length,
		aiNodeCount: aiNodes.length,
	};

	if (advanced.includeWorkflowMetadata !== false) result.workflow = metadata;
	if (advanced.includeTokenUsage !== false) result.totalTokens = totalTokens;
	if (advanced.includeErrors !== false) {
		const errors = nodes.filter((n) => n.status === 'error').map((n) => ({ node: n.name, error: n.error }));
		result.errors = errors;
	}

	return result;
}

function handleTokenSummary(ctx: IExecuteFunctions, execution: any, i: number): IDataObject {
	const groupBy = ctx.getNodeParameter('groupBy', i, 'none') as GroupBy;
	const metadata = extractWorkflowMetadata(execution);
	const aiNodes = extractAiAnalytics(execution);
	const grouped = aggregateTokens(aiNodes, groupBy, metadata.workflowName);

	return {
		executionId: metadata.executionId,
		groupBy,
		aiNodeCount: aiNodes.length,
		total: sumTokens(aiNodes),
		groups: grouped as unknown as IDataObject[],
	};
}

function handleWorkflowSummary(execution: any): IDataObject {
	const metadata = extractWorkflowMetadata(execution);
	const nodes = extractNodeAnalytics(execution);
	return {
		...metadata,
		durationHuman: formatDuration(metadata.duration_ms),
		successfulNodes: nodes.filter((n) => n.status === 'success').length,
		failedNodes: nodes.filter((n) => n.status === 'error').length,
		aiNodeCount: nodes.filter((n) => n.isAiNode).length,
	} as unknown as IDataObject;
}

function handleAiModelSummary(execution: any): IDataObject {
	const metadata = extractWorkflowMetadata(execution);
	const aiNodes = extractAiAnalytics(execution);
	const grouped = aggregateTokens(aiNodes, 'model', metadata.workflowName);

	return {
		executionId: metadata.executionId,
		modelCount: grouped.length,
		models: grouped.map((g) => ({
			model: g.group,
			nodeCount: g.nodeCount,
			tokens: g.tokens,
		})),
		nodes: aiNodes as unknown as IDataObject[],
	};
}

function handleCostSummary(
	ctx: IExecuteFunctions,
	execution: any,
	i: number,
	node: any,
): IDataObject {
	const costSource = ctx.getNodeParameter('costSource', i, 'builtin') as string;
	const currency = ctx.getNodeParameter('currency', i, 'USD') as string;

	let customPricing: Record<string, { prompt: number; completion: number }> | undefined;
	if (costSource === 'custom') {
		const raw = ctx.getNodeParameter('customPricing', i, {});
		customPricing = typeof raw === 'string' ? safeParseJson(raw, node) : (raw as any);
		validateCustomPricing(customPricing, node);
	}

	const metadata = extractWorkflowMetadata(execution);
	const aiNodes = extractAiAnalytics(execution);

	let grandTotal = 0;
	const perNode = aiNodes.map((n) => {
		const cost = calculateCost(n.tokens, n.model, currency, customPricing);
		grandTotal += cost.total_cost;
		return {
			node: n.node,
			provider: n.provider,
			model: n.model,
			tokens: n.tokens,
			cost,
		};
	});

	return {
		executionId: metadata.executionId,
		currency: currency.toUpperCase(),
		costSource,
		totalCost: Math.round(grandTotal * 1e6) / 1e6,
		nodes: perNode as unknown as IDataObject[],
	};
}

function handleNodeStatistics(
	ctx: IExecuteFunctions,
	execution: any,
	i: number,
	advanced: AdvancedOptions,
): IDataObject {
	const filterType = ctx.getNodeParameter('filterType', i, 'all') as FilterType;
	const metadata = extractWorkflowMetadata(execution);
	let nodes = extractNodeAnalytics(execution);
	nodes = filterNodes(nodes, filterType);

	const stats = nodes.map((n) => {
		const entry: IDataObject = {
			name: n.name,
			type: n.type,
			order: n.order,
			status: n.status,
			items: n.items,
			retries: n.retries,
			isAiNode: n.isAiNode,
		};
		if (advanced.includeNodeTiming !== false) {
			entry.startTime = n.startTime;
			entry.endTime = n.endTime;
			entry.duration_ms = n.duration_ms;
			entry.duration = formatDuration(n.duration_ms);
		}
		if (advanced.includeErrors !== false && n.error) entry.error = n.error;
		return entry;
	});

	return {
		executionId: metadata.executionId,
		filter: filterType,
		nodeCount: stats.length,
		nodes: stats,
	};
}

function handleExecutionTimeline(execution: any): IDataObject {
	const metadata = extractWorkflowMetadata(execution);
	const nodes = extractNodeAnalytics(execution);
	const timeline = buildTimeline(nodes);

	return {
		executionId: metadata.executionId,
		totalDuration_ms: metadata.duration_ms,
		totalDuration: formatDuration(metadata.duration_ms),
		timeline: timeline.map((t) => ({
			...t,
			duration: formatDuration(t.duration_ms),
			label: `${t.order}. ${t.node} → ${formatDuration(t.duration_ms)} [${t.status}]`,
		})),
	};
}

function handleExportAnalytics(
	ctx: IExecuteFunctions,
	execution: any,
	i: number,
	advanced: AdvancedOptions,
): IDataObject {
	const outputFormat = ctx.getNodeParameter('outputFormat', i, 'json') as string;

	const metadata = extractWorkflowMetadata(execution);
	const nodes = extractNodeAnalytics(execution);
	const aiNodes = extractAiAnalytics(execution);

	const full: IDataObject = {};
	if (advanced.includeWorkflowMetadata !== false) full.workflow = metadata as unknown as IDataObject;
	full.nodes = nodes as unknown as IDataObject[];
	if (advanced.includeAiMetadata !== false) full.aiNodes = aiNodes as unknown as IDataObject[];
	if (advanced.includeTokenUsage !== false) full.totalTokens = sumTokens(aiNodes);
	if (advanced.includeErrors !== false) {
		full.errors = nodes
			.filter((n) => n.status === 'error')
			.map((n) => ({ node: n.name, error: n.error }));
	}

	switch (outputFormat) {
		case 'flatJson':
			return { format: 'flatJson', data: toFlatJson(full) };
		case 'csv':
			// CSV is most useful over the per-node array.
			return { format: 'csv', data: toCsv(nodes) };
		case 'markdown':
			return {
				format: 'markdown',
				data: toMarkdown(nodes, `Analytics — ${metadata.workflowName || metadata.executionId}`),
			};
		case 'json':
		default:
			return { format: 'json', data: full };
	}
}

/* ------------------------------------------------------------------ *
 *  Small helpers
 * ------------------------------------------------------------------ */

function sumTokens(aiNodes: IAiNodeAnalytics[]): ITokenUsage {
	return aiNodes.reduce<ITokenUsage>(
		(acc, n) => ({
			prompt_tokens: acc.prompt_tokens + n.tokens.prompt_tokens,
			completion_tokens: acc.completion_tokens + n.tokens.completion_tokens,
			cached_tokens: acc.cached_tokens + n.tokens.cached_tokens,
			reasoning_tokens: acc.reasoning_tokens + n.tokens.reasoning_tokens,
			total_tokens: acc.total_tokens + n.tokens.total_tokens,
		}),
		{
			prompt_tokens: 0,
			completion_tokens: 0,
			cached_tokens: 0,
			reasoning_tokens: 0,
			total_tokens: 0,
		},
	);
}

function safeParseJson(raw: string, node: any): Record<string, any> {
	try {
		return JSON.parse(raw);
	} catch {
		throw new NodeOperationError(node, 'Custom Pricing is not valid JSON.');
	}
}
