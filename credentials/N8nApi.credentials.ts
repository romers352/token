import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * n8n API Credentials
 *
 * Used to authenticate with the n8n REST API to fetch execution data.
 * Requires an API key generated from n8n Settings → API.
 */
export class N8nApi implements ICredentialType {
	name = 'n8nApi';
	displayName = 'n8n API';
	documentationUrl = 'https://docs.n8n.io/api/';

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'http://localhost:5678',
			placeholder: 'https://your-n8n-instance.com',
			description: 'The base URL of your n8n instance (without trailing slash)',
			required: true,
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			placeholder: 'n8n_api_...',
			description: 'API key generated from n8n Settings → API → Create API Key',
			required: true,
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-N8N-API-KEY': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/api/v1/executions',
			qs: {
				limit: '1',
			},
		},
	};
}
