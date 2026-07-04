import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

/**
 * Make an authenticated request to the n8n API.
 *
 * @param method - HTTP method
 * @param endpoint - API path (e.g. '/api/v1/executions/123')
 * @param body - Optional request body
 * @param query - Optional query parameters
 */
export async function n8nApiRequest(
	this: IExecuteFunctions,
	method: IHttpRequestMethods,
	endpoint: string,
	body?: IDataObject,
	query?: IDataObject,
): Promise<any> {
	const credentials = await this.getCredentials('n8nApi');

	const baseUrl = (credentials.baseUrl as string).replace(/\/+$/, '');

	const options: any = {
		method,
		url: `${baseUrl}${endpoint}`,
		headers: {
			'X-N8N-API-KEY': credentials.apiKey as string,
			'Accept': 'application/json',
		},
		json: true,
	};

	if (body && Object.keys(body).length > 0) {
		options.body = body;
	}

	if (query && Object.keys(query).length > 0) {
		options.qs = query;
	}

	try {
		return await this.helpers.httpRequest(options);
	} catch (error: any) {
		throw new NodeApiError(this.getNode(), error, {
			message: `n8n API request failed: ${error.message}`,
			description: `${method} ${endpoint} returned an error`,
		});
	}
}

/**
 * Resolve the execution ID from node parameters.
 * If "Use Current Execution" is checked, returns the current execution ID.
 * Otherwise, returns the manually entered execution ID.
 */
export function resolveExecutionId(
	context: IExecuteFunctions,
	itemIndex: number,
): string {
	const useCurrentExecution = context.getNodeParameter(
		'useCurrentExecution',
		itemIndex,
		false,
	) as boolean;

	if (useCurrentExecution) {
		const executionData = context.getExecutionId();
		if (executionData) {
			return executionData;
		}
		throw new Error('Could not retrieve current execution ID. Provide an execution ID manually.');
	}

	return context.getNodeParameter('executionId', itemIndex, '') as string;
}

/**
 * Format a duration in milliseconds to a human-readable string.
 * Examples: "1.23s", "45.6ms", "2m 15s"
 */
export function formatDuration(ms: number): string {
	if (ms < 0) return '0ms';
	if (ms < 1000) return `${Math.round(ms)}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;

	const minutes = Math.floor(ms / 60000);
	const seconds = ((ms % 60000) / 1000).toFixed(1);
	return `${minutes}m ${seconds}s`;
}

/**
 * Safely access a deeply nested property using dot notation.
 * Returns undefined if any part of the path doesn't exist.
 */
export function deepGet(obj: any, path: string): any {
	if (!obj || !path) return undefined;

	const keys = path.split('.');
	let current = obj;

	for (const key of keys) {
		if (current === null || current === undefined) return undefined;
		current = current[key];
	}

	return current;
}

/**
 * Safely parse a date value to an ISO string.
 * Returns empty string if the value is invalid.
 */
export function safeDate(value: any): string {
	if (!value) return '';
	try {
		const date = new Date(value);
		if (isNaN(date.getTime())) return '';
		return date.toISOString();
	} catch {
		return '';
	}
}

/**
 * Calculate the duration between two date values in milliseconds.
 */
export function calculateDuration(start: any, end: any): number {
	if (!start || !end) return 0;
	try {
		const startDate = new Date(start);
		const endDate = new Date(end);
		if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return 0;
		return endDate.getTime() - startDate.getTime();
	} catch {
		return 0;
	}
}
