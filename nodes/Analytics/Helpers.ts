import { calculateDuration, deepGet, safeDate } from './GenericFunctions';

/* ------------------------------------------------------------------ *
 *  Types
 * ------------------------------------------------------------------ */

export interface ITokenUsage {
	prompt_tokens: number;
	completion_tokens: number;
	cached_tokens: number;
	reasoning_tokens: number;
	total_tokens: number;
}

export interface IAiNodeAnalytics {
	node: string;
	type: string;
	provider: string;
	model: string;
	tokens: ITokenUsage;
	latency_ms: number;
	runs: number;
}

export interface INodeAnalytics {
	name: string;
	type: string;
	order: number;
	status: 'success' | 'error' | 'unknown';
	startTime: string;
	endTime: string;
	duration_ms: number;
	items: number;
	retries: number;
	error?: string;
	isAiNode: boolean;
}

export interface ITimelineEntry {
	order: number;
	node: string;
	type: string;
	startTime: string;
	duration_ms: number;
	status: string;
}

export interface ICostBreakdown {
	prompt_cost: number;
	completion_cost: number;
	reasoning_cost: number;
	total_cost: number;
	currency: string;
}

export interface IWorkflowMetadata {
	workflowId: string;
	workflowName: string;
	executionId: string;
	status: string;
	mode: string;
	startedAt: string;
	stoppedAt: string;
	duration_ms: number;
	nodeCount: number;
	finished: boolean;
	error?: string;
}

/* ------------------------------------------------------------------ *
 *  Provider detection
 * ------------------------------------------------------------------ */

const PROVIDER_PATTERNS: Array<[string, RegExp]> = [
	['OpenAI', /openai|openAi|gpt|davinci|o1|o3/i],
	['Anthropic', /anthropic|claude/i],
	['Google Gemini', /google|gemini|palm|vertex/i],
	['Mistral', /mistral|mixtral/i],
	['Groq', /groq/i],
	['Ollama', /ollama/i],
	['OpenRouter', /openrouter/i],
	['Cohere', /cohere/i],
	['DeepSeek', /deepseek/i],
];

/**
 * Node type patterns that are known AI/LLM nodes.
 */
const AI_TYPE_PATTERN =
	/langchain|\blm[A-Z]|lmchat|openai|anthropic|gemini|mistral|groq|ollama|openrouter|cohere|deepseek|\bai[A-Z]|agent|embeddings/i;

/**
 * Determine the provider name from a node type string and/or model name.
 */
export function detectProvider(nodeType: string, model?: string): string {
	const haystack = `${nodeType} ${model ?? ''}`;
	for (const [name, pattern] of PROVIDER_PATTERNS) {
		if (pattern.test(haystack)) return name;
	}
	return 'Unknown';
}

/* ------------------------------------------------------------------ *
 *  Token extraction
 * ------------------------------------------------------------------ */

const zeroTokens = (): ITokenUsage => ({
	prompt_tokens: 0,
	completion_tokens: 0,
	cached_tokens: 0,
	reasoning_tokens: 0,
	total_tokens: 0,
});

const PROMPT_KEYS = ['prompt_tokens', 'promptTokens', 'input_tokens', 'inputTokens'];
const COMPLETION_KEYS = [
	'completion_tokens',
	'completionTokens',
	'output_tokens',
	'outputTokens',
];
const TOTAL_KEYS = ['total_tokens', 'totalTokens'];

function firstNumber(obj: Record<string, any>, keys: string[]): number {
	for (const key of keys) {
		const v = obj[key];
		if (typeof v === 'number' && !isNaN(v)) return v;
	}
	return 0;
}

/**
 * Recursively search an object graph for the first token-usage-like object.
 * Providers nest this differently (usage, tokenUsage, token_usage, metadata.usage...).
 */
export function findTokenUsageObject(
	value: any,
	depth = 0,
): Record<string, any> | undefined {
	if (!value || typeof value !== 'object' || depth > 8) return undefined;

	// Direct hit: this object itself looks like a usage object.
	const keys = Object.keys(value);
	const looksLikeUsage = keys.some((k) =>
		/(_|^)(tokens|token_count)$/i.test(k) ||
		['prompt_tokens', 'completion_tokens', 'input_tokens', 'output_tokens', 'total_tokens'].includes(k),
	);
	if (looksLikeUsage) return value;

	// Named containers get priority.
	for (const named of ['tokenUsage', 'token_usage', 'usage']) {
		if (value[named] && typeof value[named] === 'object') {
			const found = findTokenUsageObject(value[named], depth + 1);
			if (found) return found;
		}
	}

	// Otherwise recurse into children.
	for (const child of Object.values(value)) {
		if (child && typeof child === 'object') {
			const found = findTokenUsageObject(child, depth + 1);
			if (found) return found;
		}
	}

	return undefined;
}

/**
 * Extract and normalize token usage from a raw usage object.
 */
export function extractTokenUsage(rawUsage: Record<string, any> | undefined): ITokenUsage {
	if (!rawUsage) return zeroTokens();

	const prompt = firstNumber(rawUsage, PROMPT_KEYS);
	const completion = firstNumber(rawUsage, COMPLETION_KEYS);

	// Cached & reasoning tokens live in details objects on some providers.
	const promptDetails =
		rawUsage.prompt_tokens_details || rawUsage.input_tokens_details || {};
	const completionDetails = rawUsage.completion_tokens_details || {};

	const cached =
		firstNumber(rawUsage, ['cached_tokens', 'cache_read_input_tokens']) ||
		firstNumber(promptDetails, ['cached_tokens', 'cache_read_input_tokens']);

	const reasoning =
		firstNumber(rawUsage, ['reasoning_tokens']) ||
		firstNumber(completionDetails, ['reasoning_tokens']);

	let total = firstNumber(rawUsage, TOTAL_KEYS);
	if (total === 0) total = prompt + completion;

	return {
		prompt_tokens: prompt,
		completion_tokens: completion,
		cached_tokens: cached,
		reasoning_tokens: reasoning,
		total_tokens: total,
	};
}

export function addTokens(a: ITokenUsage, b: ITokenUsage): ITokenUsage {
	return {
		prompt_tokens: a.prompt_tokens + b.prompt_tokens,
		completion_tokens: a.completion_tokens + b.completion_tokens,
		cached_tokens: a.cached_tokens + b.cached_tokens,
		reasoning_tokens: a.reasoning_tokens + b.reasoning_tokens,
		total_tokens: a.total_tokens + b.total_tokens,
	};
}

/* ------------------------------------------------------------------ *
 *  Model extraction
 * ------------------------------------------------------------------ */

/**
 * Try to determine which model a node used, from its output data or parameters.
 */
export function extractModel(runEntry: any, nodeParams?: any): string {
	// Common output locations.
	const candidates = [
		deepGet(runEntry, 'data.main.0.0.json.model'),
		deepGet(runEntry, 'data.main.0.0.json.response.model'),
		deepGet(runEntry, 'data.main.0.0.json.tokenUsage.model'),
	];
	for (const c of candidates) {
		if (typeof c === 'string' && c) return c;
	}

	// Fall back to node parameters.
	if (nodeParams) {
		const paramModel =
			deepGet(nodeParams, 'model') ||
			deepGet(nodeParams, 'model.value') ||
			deepGet(nodeParams, 'modelId.value') ||
			deepGet(nodeParams, 'options.model');
		if (typeof paramModel === 'string' && paramModel) return paramModel;
	}

	return 'unknown';
}

/* ------------------------------------------------------------------ *
 *  runData traversal
 * ------------------------------------------------------------------ */

interface IParsedExecution {
	runData: Record<string, any[]>;
	workflow: any;
	nodeParamsByName: Record<string, any>;
}

/**
 * Extract the pieces of the execution response we care about.
 */
export function parseExecution(execution: any): IParsedExecution {
	const runData = deepGet(execution, 'data.resultData.runData') || {};
	const workflow = execution.workflowData || execution.workflow || {};

	const nodeParamsByName: Record<string, any> = {};
	const wfNodes = workflow.nodes || [];
	for (const n of wfNodes) {
		if (n && n.name) nodeParamsByName[n.name] = n.parameters || {};
	}

	return { runData, workflow, nodeParamsByName };
}

function isAiNode(nodeName: string, nodeType: string, runs: any[]): boolean {
	if (AI_TYPE_PATTERN.test(nodeType)) return true;
	// Fallback: output contains token-like fields → treat as AI node.
	for (const run of runs) {
		if (findTokenUsageObject(run)) return true;
	}
	return false;
}

/**
 * Walk every node in runData exactly once, producing per-node analytics.
 */
export function extractNodeAnalytics(execution: any): INodeAnalytics[] {
	const { runData, workflow } = parseExecution(execution);
	const typeByName: Record<string, string> = {};
	for (const n of workflow.nodes || []) {
		if (n && n.name) typeByName[n.name] = n.type || '';
	}

	const results: INodeAnalytics[] = [];

	for (const [nodeName, runs] of Object.entries(runData)) {
		const runArray = Array.isArray(runs) ? runs : [];
		const nodeType = typeByName[nodeName] || '';

		let startTime = '';
		let endTime = '';
		let duration = 0;
		let items = 0;
		let status: INodeAnalytics['status'] = 'unknown';
		let error: string | undefined;

		for (const run of runArray) {
			const st = run?.startTime ? new Date(run.startTime).getTime() : 0;
			const et = st + (run?.executionTime ?? 0);
			if (st && (!startTime || st < new Date(startTime).getTime())) {
				startTime = new Date(st).toISOString();
			}
			if (et && (!endTime || et > new Date(endTime).getTime())) {
				endTime = new Date(et).toISOString();
			}
			duration += run?.executionTime ?? 0;

			const mainOut = deepGet(run, 'data.main.0');
			if (Array.isArray(mainOut)) items += mainOut.length;

			if (run?.error) {
				status = 'error';
				error = run.error.message || String(run.error);
			} else if (status !== 'error') {
				status = 'success';
			}
		}

		results.push({
			name: nodeName,
			type: nodeType,
			order: 0,
			status,
			startTime,
			endTime,
			duration_ms: duration,
			items,
			retries: Math.max(0, runArray.length - 1),
			error,
			isAiNode: isAiNode(nodeName, nodeType, runArray),
		});
	}

	// Assign execution order by start time.
	results.sort((a, b) => {
		const at = a.startTime ? new Date(a.startTime).getTime() : Number.MAX_SAFE_INTEGER;
		const bt = b.startTime ? new Date(b.startTime).getTime() : Number.MAX_SAFE_INTEGER;
		return at - bt;
	});
	results.forEach((r, i) => (r.order = i + 1));

	return results;
}

/**
 * Extract AI-specific analytics (tokens, model, provider, latency) per AI node.
 */
export function extractAiAnalytics(execution: any): IAiNodeAnalytics[] {
	const { runData, workflow, nodeParamsByName } = parseExecution(execution);
	const typeByName: Record<string, string> = {};
	for (const n of workflow.nodes || []) {
		if (n && n.name) typeByName[n.name] = n.type || '';
	}

	const results: IAiNodeAnalytics[] = [];

	for (const [nodeName, runs] of Object.entries(runData)) {
		const runArray = Array.isArray(runs) ? runs : [];
		const nodeType = typeByName[nodeName] || '';

		if (!isAiNode(nodeName, nodeType, runArray)) continue;

		let tokens = zeroTokens();
		let latency = 0;
		let model = 'unknown';

		for (const run of runArray) {
			const usage = findTokenUsageObject(run);
			tokens = addTokens(tokens, extractTokenUsage(usage));
			latency += run?.executionTime ?? 0;
			if (model === 'unknown') {
				model = extractModel(run, nodeParamsByName[nodeName]);
			}
		}

		results.push({
			node: nodeName,
			type: nodeType,
			provider: detectProvider(nodeType, model),
			model,
			tokens,
			latency_ms: latency,
			runs: runArray.length,
		});
	}

	return results;
}

/* ------------------------------------------------------------------ *
 *  Aggregation
 * ------------------------------------------------------------------ */

export type GroupBy = 'none' | 'provider' | 'model' | 'workflow' | 'node';

export interface IAggregatedTokens {
	group: string;
	tokens: ITokenUsage;
	nodeCount: number;
}

/**
 * Aggregate AI node token usage by the requested grouping.
 */
export function aggregateTokens(
	aiNodes: IAiNodeAnalytics[],
	groupBy: GroupBy,
	workflowName = 'workflow',
): IAggregatedTokens[] {
	if (groupBy === 'none') {
		const total = aiNodes.reduce((acc, n) => addTokens(acc, n.tokens), zeroTokens());
		return [{ group: 'total', tokens: total, nodeCount: aiNodes.length }];
	}

	const map = new Map<string, IAggregatedTokens>();
	for (const node of aiNodes) {
		let key: string;
		switch (groupBy) {
			case 'provider':
				key = node.provider;
				break;
			case 'model':
				key = node.model;
				break;
			case 'node':
				key = node.node;
				break;
			case 'workflow':
				key = workflowName;
				break;
			default:
				key = 'total';
		}

		const existing = map.get(key);
		if (existing) {
			existing.tokens = addTokens(existing.tokens, node.tokens);
			existing.nodeCount += 1;
		} else {
			map.set(key, { group: key, tokens: { ...node.tokens }, nodeCount: 1 });
		}
	}

	return Array.from(map.values());
}

/* ------------------------------------------------------------------ *
 *  Pricing & cost
 * ------------------------------------------------------------------ */

/** Prices are USD per 1,000,000 tokens. */
export const PRICING: Record<string, { prompt: number; completion: number }> = {
	'gpt-4o': { prompt: 2.5, completion: 10.0 },
	'gpt-4o-mini': { prompt: 0.15, completion: 0.6 },
	'gpt-4-turbo': { prompt: 10.0, completion: 30.0 },
	'gpt-4': { prompt: 30.0, completion: 60.0 },
	'gpt-3.5-turbo': { prompt: 0.5, completion: 1.5 },
	'o1': { prompt: 15.0, completion: 60.0 },
	'o1-mini': { prompt: 3.0, completion: 12.0 },
	'o3-mini': { prompt: 1.1, completion: 4.4 },
	'claude-3-5-sonnet': { prompt: 3.0, completion: 15.0 },
	'claude-3-5-haiku': { prompt: 0.8, completion: 4.0 },
	'claude-3-opus': { prompt: 15.0, completion: 75.0 },
	'claude-3-sonnet': { prompt: 3.0, completion: 15.0 },
	'claude-3-haiku': { prompt: 0.25, completion: 1.25 },
	'gemini-1.5-pro': { prompt: 1.25, completion: 5.0 },
	'gemini-1.5-flash': { prompt: 0.075, completion: 0.3 },
	'gemini-2.0-flash': { prompt: 0.1, completion: 0.4 },
	'mistral-large': { prompt: 2.0, completion: 6.0 },
	'mistral-small': { prompt: 0.2, completion: 0.6 },
	'llama-3-70b': { prompt: 0.59, completion: 0.79 },
	'llama-3-8b': { prompt: 0.05, completion: 0.08 },
	'deepseek-chat': { prompt: 0.27, completion: 1.1 },
};

/** Approximate FX rates from USD, for display convenience only. */
const FX_RATES: Record<string, number> = {
	USD: 1,
	EUR: 0.92,
	NPR: 133.0,
	GBP: 0.79,
	INR: 83.0,
};

/**
 * Look up pricing for a model, tolerating version suffixes via prefix matching.
 */
export function findPricing(
	model: string,
	pricingTable: Record<string, { prompt: number; completion: number }>,
): { prompt: number; completion: number } | undefined {
	if (!model) return undefined;
	const normalized = model.toLowerCase();

	if (pricingTable[normalized]) return pricingTable[normalized];

	// Exact key match (case-insensitive).
	for (const key of Object.keys(pricingTable)) {
		if (key.toLowerCase() === normalized) return pricingTable[key];
	}

	// Longest-prefix fuzzy match: "gpt-4o-2024-08-06" → "gpt-4o".
	let best: { key: string; price: { prompt: number; completion: number } } | undefined;
	for (const key of Object.keys(pricingTable)) {
		const k = key.toLowerCase();
		if (normalized.includes(k) || normalized.startsWith(k)) {
			if (!best || k.length > best.key.length) {
				best = { key: k, price: pricingTable[key] };
			}
		}
	}
	return best?.price;
}

/**
 * Calculate cost for a token usage against a model's pricing.
 */
export function calculateCost(
	tokens: ITokenUsage,
	model: string,
	currency: string,
	customPricing?: Record<string, { prompt: number; completion: number }>,
): ICostBreakdown {
	const table = { ...PRICING, ...(customPricing || {}) };
	const price = findPricing(model, table);
	const fx = FX_RATES[currency.toUpperCase()] ?? 1;

	if (!price) {
		return {
			prompt_cost: 0,
			completion_cost: 0,
			reasoning_cost: 0,
			total_cost: 0,
			currency,
		};
	}

	// Non-cached prompt tokens are billed at full prompt rate.
	const billablePrompt = Math.max(0, tokens.prompt_tokens - tokens.cached_tokens);
	const promptCost = (billablePrompt / 1_000_000) * price.prompt * fx;
	const cachedCost = (tokens.cached_tokens / 1_000_000) * price.prompt * 0.5 * fx;
	const completionCost = (tokens.completion_tokens / 1_000_000) * price.completion * fx;
	const reasoningCost = (tokens.reasoning_tokens / 1_000_000) * price.completion * fx;

	const round = (n: number) => Math.round(n * 1e6) / 1e6;

	return {
		prompt_cost: round(promptCost + cachedCost),
		completion_cost: round(completionCost),
		reasoning_cost: round(reasoningCost),
		total_cost: round(promptCost + cachedCost + completionCost + reasoningCost),
		currency: currency.toUpperCase(),
	};
}

/* ------------------------------------------------------------------ *
 *  Timeline & metadata
 * ------------------------------------------------------------------ */

export function buildTimeline(nodes: INodeAnalytics[]): ITimelineEntry[] {
	return nodes.map((n) => ({
		order: n.order,
		node: n.name,
		type: n.type,
		startTime: n.startTime,
		duration_ms: n.duration_ms,
		status: n.status,
	}));
}

export function extractWorkflowMetadata(execution: any): IWorkflowMetadata {
	const { workflow, runData } = parseExecution(execution);
	const startedAt = safeDate(execution.startedAt);
	const stoppedAt = safeDate(execution.stoppedAt);

	return {
		workflowId: String(execution.workflowId ?? workflow.id ?? ''),
		workflowName: workflow.name ?? '',
		executionId: String(execution.id ?? ''),
		status: execution.status ?? (execution.finished ? 'success' : 'unknown'),
		mode: execution.mode ?? '',
		startedAt,
		stoppedAt,
		duration_ms: calculateDuration(execution.startedAt, execution.stoppedAt),
		nodeCount: Object.keys(runData).length,
		finished: Boolean(execution.finished),
		error: deepGet(execution, 'data.resultData.error.message'),
	};
}

/* ------------------------------------------------------------------ *
 *  Filters
 * ------------------------------------------------------------------ */

export type FilterType = 'all' | 'ai' | 'failed' | 'successful' | 'trigger' | 'http';

export function filterNodes(nodes: INodeAnalytics[], filter: FilterType): INodeAnalytics[] {
	switch (filter) {
		case 'ai':
			return nodes.filter((n) => n.isAiNode);
		case 'failed':
			return nodes.filter((n) => n.status === 'error');
		case 'successful':
			return nodes.filter((n) => n.status === 'success');
		case 'trigger':
			return nodes.filter((n) => /trigger|webhook|cron|schedule|manual/i.test(n.type));
		case 'http':
			return nodes.filter((n) => /httpRequest|http\b/i.test(n.type));
		case 'all':
		default:
			return nodes;
	}
}

/* ------------------------------------------------------------------ *
 *  Export formatters
 * ------------------------------------------------------------------ */

/**
 * Flatten a nested object into dot-notation keys.
 */
export function toFlatJson(data: any, prefix = ''): Record<string, any> {
	const out: Record<string, any> = {};

	const walk = (value: any, path: string) => {
		if (value === null || value === undefined) {
			out[path] = value;
			return;
		}
		if (Array.isArray(value)) {
			if (value.length === 0) {
				out[path] = [];
				return;
			}
			value.forEach((item, i) => walk(item, path ? `${path}.${i}` : String(i)));
			return;
		}
		if (typeof value === 'object') {
			const keys = Object.keys(value);
			if (keys.length === 0) {
				out[path] = {};
				return;
			}
			for (const key of keys) {
				walk(value[key], path ? `${path}.${key}` : key);
			}
			return;
		}
		out[path] = value;
	};

	walk(data, prefix);
	return out;
}

function csvEscape(value: any): string {
	if (value === null || value === undefined) return '';
	const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
	if (/[",\n]/.test(str)) {
		return `"${str.replace(/"/g, '""')}"`;
	}
	return str;
}

/**
 * Convert an array of flat objects (or a single object) to CSV.
 */
export function toCsv(data: any): string {
	const rows: Record<string, any>[] = Array.isArray(data)
		? data.map((d) => (typeof d === 'object' && d !== null ? toFlatJson(d) : { value: d }))
		: [toFlatJson(data)];

	if (rows.length === 0) return '';

	const headerSet = new Set<string>();
	for (const row of rows) {
		Object.keys(row).forEach((k) => headerSet.add(k));
	}
	const headers = Array.from(headerSet);

	const lines = [headers.map(csvEscape).join(',')];
	for (const row of rows) {
		lines.push(headers.map((h) => csvEscape(row[h])).join(','));
	}
	return lines.join('\n');
}

/**
 * Convert data to a Markdown representation. Arrays of objects become tables.
 */
export function toMarkdown(data: any, title = 'Analytics'): string {
	const lines: string[] = [`## ${title}`, ''];

	const renderTable = (rows: Record<string, any>[]) => {
		const flat = rows.map((r) => toFlatJson(r));
		const headerSet = new Set<string>();
		for (const row of flat) {
			Object.keys(row).forEach((k) => headerSet.add(k));
		}
		const headers = Array.from(headerSet);
		lines.push(`| ${headers.join(' | ')} |`);
		lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
		for (const row of flat) {
			lines.push(
				`| ${headers
					.map((h) => {
						const v = row[h];
						return v === null || v === undefined
							? ''
							: typeof v === 'object'
								? JSON.stringify(v)
								: String(v);
					})
					.join(' | ')} |`,
			);
		}
	};

	if (Array.isArray(data)) {
		if (data.length && typeof data[0] === 'object') {
			renderTable(data);
		} else {
			data.forEach((d) => lines.push(`- ${String(d)}`));
		}
	} else if (data && typeof data === 'object') {
		const flat = toFlatJson(data);
		lines.push('| Key | Value |', '| --- | --- |');
		for (const [k, v] of Object.entries(flat)) {
			const val = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
			lines.push(`| ${k} | ${val} |`);
		}
	} else {
		lines.push(String(data));
	}

	return lines.join('\n');
}
