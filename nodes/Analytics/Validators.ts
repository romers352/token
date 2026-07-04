import { NodeOperationError } from 'n8n-workflow';
import type { INode } from 'n8n-workflow';

/**
 * Validate that an execution ID is present and well-formed.
 * Accepts numeric IDs (legacy) and string IDs (modern n8n).
 */
export function validateExecutionId(id: string, node: INode): void {
	if (!id || id.trim() === '') {
		throw new NodeOperationError(
			node,
			'Execution ID is required. Either provide one manually or enable "Use Current Execution".',
		);
	}

	const trimmed = id.trim();

	// Accept numeric IDs (e.g., "12345") or alphanumeric/UUID-style IDs
	if (!/^[a-zA-Z0-9\-_]+$/.test(trimmed)) {
		throw new NodeOperationError(
			node,
			`Invalid Execution ID format: "${trimmed}". Must contain only letters, numbers, hyphens, or underscores.`,
		);
	}
}

/**
 * Validate that execution data contains the expected structure.
 */
export function validateExecutionData(data: any, node: INode): void {
	if (!data) {
		throw new NodeOperationError(
			node,
			'Execution data is empty. The execution may have been deleted or data saving is disabled.',
		);
	}

	if (!data.data) {
		throw new NodeOperationError(
			node,
			'Execution response is missing the "data" field. Ensure you are fetching with includeData=true.',
		);
	}

	if (!data.data?.resultData?.runData) {
		throw new NodeOperationError(
			node,
			'Execution is missing runData. This can happen if the execution has not completed yet or if "Save Execution Data" is disabled in the workflow settings.',
		);
	}
}

/**
 * Validate custom pricing configuration.
 * Ensures the pricing object has the expected structure.
 */
export function validateCustomPricing(pricing: any, node: INode): void {
	if (!pricing || typeof pricing !== 'object') {
		throw new NodeOperationError(
			node,
			'Custom pricing must be a valid JSON object. Example: {"gpt-4o": {"prompt": 2.50, "completion": 10.00}}',
		);
	}

	for (const [model, prices] of Object.entries(pricing)) {
		if (!prices || typeof prices !== 'object') {
			throw new NodeOperationError(
				node,
				`Invalid pricing for model "${model}". Each model must have an object with "prompt" and "completion" prices.`,
			);
		}

		const p = prices as any;
		if (typeof p.prompt !== 'number' || typeof p.completion !== 'number') {
			throw new NodeOperationError(
				node,
				`Invalid pricing for model "${model}". "prompt" and "completion" must be numbers (price per 1M tokens).`,
			);
		}
	}
}
