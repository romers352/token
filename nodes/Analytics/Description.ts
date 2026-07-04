import type { INodeProperties } from 'n8n-workflow';

/**
 * UI definition for the Analytics node.
 * A single resource ("Execution Analytics") with 8 operations plus shared and
 * operation-specific parameters, and an advanced options collection.
 */

export const resources: INodeProperties[] = [
	{
		displayName: 'Resource',
		name: 'resource',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'Execution Analytics',
				value: 'executionAnalytics',
			},
		],
		default: 'executionAnalytics',
	},
];

export const operations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['executionAnalytics'],
			},
		},
		options: [
			{
				name: 'Analyze Execution',
				value: 'analyzeExecution',
				description: 'Fetch and analyze a single execution',
				action: 'Analyze an execution',
			},
			{
				name: 'Token Summary',
				value: 'tokenSummary',
				description: 'Extract AI token usage across all AI nodes',
				action: 'Summarize AI token usage',
			},
			{
				name: 'Workflow Summary',
				value: 'workflowSummary',
				description: 'Get workflow-level metadata and stats',
				action: 'Summarize the workflow',
			},
			{
				name: 'AI Model Summary',
				value: 'aiModelSummary',
				description: 'Per-model breakdown of AI usage',
				action: 'Summarize AI usage per model',
			},
			{
				name: 'Cost Summary',
				value: 'costSummary',
				description: 'Estimate costs based on token usage',
				action: 'Estimate AI costs',
			},
			{
				name: 'Node Statistics',
				value: 'nodeStatistics',
				description: 'Per-node execution stats',
				action: 'Get per-node statistics',
			},
			{
				name: 'Execution Timeline',
				value: 'executionTimeline',
				description: 'Ordered timeline of node executions',
				action: 'Build an execution timeline',
			},
			{
				name: 'Export Analytics',
				value: 'exportAnalytics',
				description: 'Export full analytics in various formats',
				action: 'Export full analytics',
			},
		],
		default: 'analyzeExecution',
	},
];

const commonParameters: INodeProperties[] = [
	{
		displayName: 'Use Current Execution',
		name: 'useCurrentExecution',
		type: 'boolean',
		default: false,
		description:
			'Whether to analyze the currently running execution instead of a manually specified one',
		displayOptions: {
			show: {
				resource: ['executionAnalytics'],
			},
		},
	},
	{
		displayName: 'Execution ID',
		name: 'executionId',
		type: 'string',
		default: '',
		placeholder: '12345',
		description: 'The ID of the execution to analyze',
		displayOptions: {
			show: {
				resource: ['executionAnalytics'],
				useCurrentExecution: [false],
			},
		},
	},
];

const operationSpecificParameters: INodeProperties[] = [
	// Token Summary → groupBy
	{
		displayName: 'Group By',
		name: 'groupBy',
		type: 'options',
		default: 'none',
		description: 'How to group the aggregated token usage',
		displayOptions: {
			show: {
				resource: ['executionAnalytics'],
				operation: ['tokenSummary'],
			},
		},
		options: [
			{ name: 'None (Total)', value: 'none' },
			{ name: 'Provider', value: 'provider' },
			{ name: 'Model', value: 'model' },
			{ name: 'Workflow', value: 'workflow' },
			{ name: 'Node', value: 'node' },
		],
	},
	// Cost Summary → costSource, currency, customPricing
	{
		displayName: 'Cost Source',
		name: 'costSource',
		type: 'options',
		default: 'builtin',
		description: 'Where to source the per-token pricing from',
		displayOptions: {
			show: {
				resource: ['executionAnalytics'],
				operation: ['costSummary'],
			},
		},
		options: [
			{ name: 'Built-in Pricing Table', value: 'builtin' },
			{ name: 'Custom Pricing', value: 'custom' },
		],
	},
	{
		displayName: 'Currency',
		name: 'currency',
		type: 'options',
		default: 'USD',
		description: 'Currency to express estimated costs in (converted from USD)',
		displayOptions: {
			show: {
				resource: ['executionAnalytics'],
				operation: ['costSummary'],
			},
		},
		options: [
			{ name: 'USD', value: 'USD' },
			{ name: 'EUR', value: 'EUR' },
			{ name: 'NPR', value: 'NPR' },
			{ name: 'GBP', value: 'GBP' },
			{ name: 'INR', value: 'INR' },
		],
	},
	{
		displayName: 'Custom Pricing (JSON)',
		name: 'customPricing',
		type: 'json',
		default: '{\n  "my-model": { "prompt": 1.0, "completion": 2.0 }\n}',
		description:
			'Custom pricing per 1M tokens, merged over the built-in table. Format: {"model": {"prompt": number, "completion": number}}.',
		displayOptions: {
			show: {
				resource: ['executionAnalytics'],
				operation: ['costSummary'],
				costSource: ['custom'],
			},
		},
	},
	// Node Statistics → filterType
	{
		displayName: 'Filter',
		name: 'filterType',
		type: 'options',
		default: 'all',
		description: 'Which nodes to include in the statistics',
		displayOptions: {
			show: {
				resource: ['executionAnalytics'],
				operation: ['nodeStatistics'],
			},
		},
		options: [
			{ name: 'All Nodes', value: 'all' },
			{ name: 'AI Nodes Only', value: 'ai' },
			{ name: 'Failed Nodes', value: 'failed' },
			{ name: 'Successful Nodes', value: 'successful' },
			{ name: 'Trigger Nodes', value: 'trigger' },
			{ name: 'HTTP Nodes', value: 'http' },
		],
	},
	// Export → outputFormat
	{
		displayName: 'Output Format',
		name: 'outputFormat',
		type: 'options',
		default: 'json',
		description: 'Format of the exported analytics payload',
		displayOptions: {
			show: {
				resource: ['executionAnalytics'],
				operation: ['exportAnalytics'],
			},
		},
		options: [
			{ name: 'JSON', value: 'json' },
			{ name: 'Flat JSON', value: 'flatJson' },
			{ name: 'CSV', value: 'csv' },
			{ name: 'Markdown', value: 'markdown' },
		],
	},
];

const advancedOptions: INodeProperties[] = [
	{
		displayName: 'Advanced Options',
		name: 'advancedOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: {
			show: {
				resource: ['executionAnalytics'],
			},
		},
		options: [
			{
				displayName: 'Include Token Usage',
				name: 'includeTokenUsage',
				type: 'boolean',
				default: true,
				description: 'Whether to include AI token usage fields where applicable',
			},
			{
				displayName: 'Include Costs',
				name: 'includeCosts',
				type: 'boolean',
				default: false,
				description: 'Whether to include estimated cost fields where applicable',
			},
			{
				displayName: 'Include Errors',
				name: 'includeErrors',
				type: 'boolean',
				default: true,
				description: 'Whether to include error details for failed nodes',
			},
			{
				displayName: 'Include Node Timing',
				name: 'includeNodeTiming',
				type: 'boolean',
				default: true,
				description: 'Whether to include per-node start/end times and durations',
			},
			{
				displayName: 'Include Workflow Metadata',
				name: 'includeWorkflowMetadata',
				type: 'boolean',
				default: true,
				description: 'Whether to include workflow-level metadata in the output',
			},
			{
				displayName: 'Include AI Metadata',
				name: 'includeAiMetadata',
				type: 'boolean',
				default: true,
				description: 'Whether to include provider/model metadata for AI nodes',
			},
			{
				displayName: 'Include Raw Execution',
				name: 'includeRawExecution',
				type: 'boolean',
				default: false,
				description: 'Whether to attach the raw execution response (large payload)',
			},
		],
	},
];

export const nodeProperties: INodeProperties[] = [
	...resources,
	...operations,
	...commonParameters,
	...operationSpecificParameters,
	...advancedOptions,
];
