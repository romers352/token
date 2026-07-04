import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';
import { n8nApiRequest } from './GenericFunctions';

/**
 * Fetch a single execution from the n8n API with full data.
 *
 * Calls GET /api/v1/executions/{id}?includeData=true
 * Returns the full execution object including runData.
 */
export async function fetchExecution(
	this: IExecuteFunctions,
	executionId: string,
): Promise<IDataObject> {
	const response = await n8nApiRequest.call(
		this,
		'GET',
		`/api/v1/executions/${encodeURIComponent(executionId)}`,
		undefined,
		{ includeData: 'true' } as IDataObject,
	);

	return response as IDataObject;
}
