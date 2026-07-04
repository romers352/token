import {
	detectProvider,
	extractTokenUsage,
	findTokenUsageObject,
	extractModel,
	aggregateTokens,
	calculateCost,
	findPricing,
	filterNodes,
	toFlatJson,
	toCsv,
	toMarkdown,
	extractNodeAnalytics,
	extractAiAnalytics,
	buildTimeline,
	PRICING,
	type IAiNodeAnalytics,
	type INodeAnalytics,
} from '../Helpers';

/* ------------------------------------------------------------------ *
 *  Fixtures
 * ------------------------------------------------------------------ */

function buildExecution() {
	return {
		id: '999',
		workflowId: 'wf-1',
		status: 'success',
		finished: true,
		mode: 'manual',
		startedAt: '2026-07-04T10:00:00.000Z',
		stoppedAt: '2026-07-04T10:00:03.000Z',
		workflowData: {
			id: 'wf-1',
			name: 'My Workflow',
			nodes: [
				{ name: 'Start', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
				{
					name: 'OpenAI',
					type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
					parameters: { model: 'gpt-4o' },
				},
				{ name: 'HTTP', type: 'n8n-nodes-base.httpRequest', parameters: {} },
			],
		},
		data: {
			resultData: {
				runData: {
					Start: [{ startTime: 1751623200000, executionTime: 5, data: { main: [[{ json: {} }]] } }],
					OpenAI: [
						{
							startTime: 1751623200100,
							executionTime: 1200,
							data: {
								main: [
									[
										{
											json: {
												model: 'gpt-4o',
												usage: {
													prompt_tokens: 1000,
													completion_tokens: 500,
													total_tokens: 1500,
												},
											},
										},
									],
								],
							},
						},
					],
					HTTP: [
						{
							startTime: 1751623201400,
							executionTime: 300,
							data: { main: [[{ json: { ok: true } }]] },
							error: { message: 'boom' },
						},
					],
				},
			},
		},
	};
}

/* ------------------------------------------------------------------ *
 *  Provider detection
 * ------------------------------------------------------------------ */

describe('detectProvider', () => {
	it('detects OpenAI', () => {
		expect(detectProvider('@n8n/n8n-nodes-langchain.lmChatOpenAi')).toBe('OpenAI');
	});
	it('detects Anthropic by model', () => {
		expect(detectProvider('someNode', 'claude-3-5-sonnet')).toBe('Anthropic');
	});
	it('detects Gemini', () => {
		expect(detectProvider('lmChatGoogleGemini')).toBe('Google Gemini');
	});
	it('falls back to Unknown', () => {
		expect(detectProvider('n8n-nodes-base.set')).toBe('Unknown');
	});
});

/* ------------------------------------------------------------------ *
 *  Token extraction & normalization
 * ------------------------------------------------------------------ */

describe('extractTokenUsage', () => {
	it('reads snake_case fields', () => {
		const t = extractTokenUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
		expect(t.prompt_tokens).toBe(10);
		expect(t.completion_tokens).toBe(5);
		expect(t.total_tokens).toBe(15);
	});

	it('normalizes Anthropic input/output token names', () => {
		const t = extractTokenUsage({ input_tokens: 20, output_tokens: 8 });
		expect(t.prompt_tokens).toBe(20);
		expect(t.completion_tokens).toBe(8);
		expect(t.total_tokens).toBe(28); // derived
	});

	it('extracts cached and reasoning tokens from detail objects', () => {
		const t = extractTokenUsage({
			prompt_tokens: 100,
			completion_tokens: 50,
			prompt_tokens_details: { cached_tokens: 40 },
			completion_tokens_details: { reasoning_tokens: 30 },
		});
		expect(t.cached_tokens).toBe(40);
		expect(t.reasoning_tokens).toBe(30);
	});

	it('returns zeros for undefined', () => {
		expect(extractTokenUsage(undefined).total_tokens).toBe(0);
	});
});

describe('findTokenUsageObject', () => {
	it('finds a deeply nested usage object', () => {
		const found = findTokenUsageObject({
			data: { main: [[{ json: { tokenUsage: { total_tokens: 7 } } }]] },
		});
		expect(found).toEqual({ total_tokens: 7 });
	});
	it('returns undefined when absent', () => {
		expect(findTokenUsageObject({ a: { b: 1 } })).toBeUndefined();
	});
});

describe('extractModel', () => {
	it('reads model from output json', () => {
		const run = { data: { main: [[{ json: { model: 'gpt-4o-mini' } }]] } };
		expect(extractModel(run)).toBe('gpt-4o-mini');
	});
	it('falls back to node parameters', () => {
		expect(extractModel({}, { model: 'claude-3-haiku' })).toBe('claude-3-haiku');
	});
	it('returns unknown when nothing found', () => {
		expect(extractModel({}, {})).toBe('unknown');
	});
});

/* ------------------------------------------------------------------ *
 *  Aggregation
 * ------------------------------------------------------------------ */

describe('aggregateTokens', () => {
	const nodes: IAiNodeAnalytics[] = [
		{ node: 'A', type: '', provider: 'OpenAI', model: 'gpt-4o', tokens: t(10, 5), latency_ms: 0, runs: 1 },
		{ node: 'B', type: '', provider: 'OpenAI', model: 'gpt-4o-mini', tokens: t(20, 10), latency_ms: 0, runs: 1 },
		{ node: 'C', type: '', provider: 'Anthropic', model: 'claude-3-haiku', tokens: t(1, 1), latency_ms: 0, runs: 1 },
	];

	it('groups by none (total)', () => {
		const r = aggregateTokens(nodes, 'none');
		expect(r).toHaveLength(1);
		expect(r[0].tokens.prompt_tokens).toBe(31);
	});
	it('groups by provider', () => {
		const r = aggregateTokens(nodes, 'provider');
		const openai = r.find((g) => g.group === 'OpenAI');
		expect(openai?.nodeCount).toBe(2);
		expect(openai?.tokens.prompt_tokens).toBe(30);
	});
	it('groups by model', () => {
		expect(aggregateTokens(nodes, 'model')).toHaveLength(3);
	});
	it('groups by workflow', () => {
		const r = aggregateTokens(nodes, 'workflow', 'WF');
		expect(r).toHaveLength(1);
		expect(r[0].group).toBe('WF');
	});
});

/* ------------------------------------------------------------------ *
 *  Pricing & cost
 * ------------------------------------------------------------------ */

describe('findPricing', () => {
	it('matches exact model', () => {
		expect(findPricing('gpt-4o', PRICING)).toEqual({ prompt: 2.5, completion: 10 });
	});
	it('fuzzy-matches versioned model by prefix', () => {
		expect(findPricing('gpt-4o-2024-08-06', PRICING)).toEqual({ prompt: 2.5, completion: 10 });
	});
	it('returns undefined for unknown model', () => {
		expect(findPricing('nonexistent-model', PRICING)).toBeUndefined();
	});
});

describe('calculateCost', () => {
	it('computes USD cost with builtin pricing', () => {
		const c = calculateCost(t(1_000_000, 1_000_000), 'gpt-4o', 'USD');
		expect(c.prompt_cost).toBeCloseTo(2.5, 5);
		expect(c.completion_cost).toBeCloseTo(10, 5);
		expect(c.total_cost).toBeCloseTo(12.5, 5);
	});
	it('applies custom pricing', () => {
		const c = calculateCost(t(1_000_000, 0), 'x', 'USD', { x: { prompt: 1, completion: 2 } });
		expect(c.prompt_cost).toBeCloseTo(1, 5);
	});
	it('converts currency', () => {
		const usd = calculateCost(t(1_000_000, 0), 'gpt-4o', 'USD');
		const eur = calculateCost(t(1_000_000, 0), 'gpt-4o', 'EUR');
		expect(eur.total_cost).toBeLessThan(usd.total_cost);
		expect(eur.currency).toBe('EUR');
	});
	it('zeroes out unknown model', () => {
		expect(calculateCost(t(100, 100), 'unknown', 'USD').total_cost).toBe(0);
	});
	it('discounts cached tokens', () => {
		const full = calculateCost(t(1_000_000, 0), 'gpt-4o', 'USD');
		const cached = calculateCost(
			{ prompt_tokens: 1_000_000, completion_tokens: 0, cached_tokens: 1_000_000, reasoning_tokens: 0, total_tokens: 1_000_000 },
			'gpt-4o',
			'USD',
		);
		expect(cached.prompt_cost).toBeLessThan(full.prompt_cost);
	});
});

/* ------------------------------------------------------------------ *
 *  Filters
 * ------------------------------------------------------------------ */

describe('filterNodes', () => {
	const nodes = [
		n('A', 'n8n-nodes-base.manualTrigger', 'success', false),
		n('B', '@n8n/n8n-nodes-langchain.lmChatOpenAi', 'success', true),
		n('C', 'n8n-nodes-base.httpRequest', 'error', false),
	];
	it('filters ai', () => expect(filterNodes(nodes, 'ai')).toHaveLength(1));
	it('filters failed', () => expect(filterNodes(nodes, 'failed')).toHaveLength(1));
	it('filters successful', () => expect(filterNodes(nodes, 'successful')).toHaveLength(2));
	it('filters trigger', () => expect(filterNodes(nodes, 'trigger')).toHaveLength(1));
	it('filters http', () => expect(filterNodes(nodes, 'http')).toHaveLength(1));
	it('all returns everything', () => expect(filterNodes(nodes, 'all')).toHaveLength(3));
});

/* ------------------------------------------------------------------ *
 *  Export formatters
 * ------------------------------------------------------------------ */

describe('toFlatJson', () => {
	it('flattens nested objects with dot notation', () => {
		const flat = toFlatJson({ a: { b: { c: 1 } }, d: [10, 20] });
		expect(flat['a.b.c']).toBe(1);
		expect(flat['d.0']).toBe(10);
		expect(flat['d.1']).toBe(20);
	});
});

describe('toCsv', () => {
	it('produces header + rows and escapes commas', () => {
		const csv = toCsv([{ name: 'a,b', n: 1 }, { name: 'c', n: 2 }]);
		const lines = csv.split('\n');
		expect(lines[0]).toBe('name,n');
		expect(lines[1]).toBe('"a,b",1');
	});
});

describe('toMarkdown', () => {
	it('renders an array of objects as a table', () => {
		const md = toMarkdown([{ x: 1 }, { x: 2 }], 'T');
		expect(md).toContain('## T');
		expect(md).toContain('| x |');
	});
});

/* ------------------------------------------------------------------ *
 *  End-to-end extraction over a full execution fixture
 * ------------------------------------------------------------------ */

describe('extractNodeAnalytics', () => {
	const nodes = extractNodeAnalytics(buildExecution());
	it('extracts all three nodes', () => expect(nodes).toHaveLength(3));
	it('orders by start time', () => {
		expect(nodes[0].name).toBe('Start');
		expect(nodes.map((n) => n.order)).toEqual([1, 2, 3]);
	});
	it('flags AI node', () => {
		expect(nodes.find((n) => n.name === 'OpenAI')?.isAiNode).toBe(true);
	});
	it('captures error status', () => {
		expect(nodes.find((n) => n.name === 'HTTP')?.status).toBe('error');
	});
});

describe('extractAiAnalytics', () => {
	const ai = extractAiAnalytics(buildExecution());
	it('finds only the AI node', () => {
		expect(ai).toHaveLength(1);
		expect(ai[0].node).toBe('OpenAI');
	});
	it('extracts tokens, model and provider', () => {
		expect(ai[0].tokens.total_tokens).toBe(1500);
		expect(ai[0].model).toBe('gpt-4o');
		expect(ai[0].provider).toBe('OpenAI');
	});
});

describe('buildTimeline', () => {
	it('preserves order', () => {
		const tl = buildTimeline(extractNodeAnalytics(buildExecution()));
		expect(tl.map((t) => t.order)).toEqual([1, 2, 3]);
	});
});

/* ------------------------------------------------------------------ *
 *  Local helpers
 * ------------------------------------------------------------------ */

function t(prompt: number, completion: number) {
	return {
		prompt_tokens: prompt,
		completion_tokens: completion,
		cached_tokens: 0,
		reasoning_tokens: 0,
		total_tokens: prompt + completion,
	};
}

function n(name: string, type: string, status: any, isAiNode: boolean): INodeAnalytics {
	return {
		name,
		type,
		order: 0,
		status,
		startTime: '',
		endTime: '',
		duration_ms: 0,
		items: 0,
		retries: 0,
		isAiNode,
	};
}
