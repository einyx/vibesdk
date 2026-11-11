// The Publisher, from the worker.
//
// The publisher applies an app's stack to the cluster: a Deployment, a
// Service and a volume per app, in the cluster's app namespace. The worker
// hands it the built bundle and gets the address the app is served from.
//
// The contract lives with the service that answers it — publisher/protocol.ts
// — so the two halves cannot drift: every response is validated against the
// same schemas the publisher writes its answers from.

import {
	PublishRequestSchema,
	PublishResponseSchema,
	PublishStatusResponseSchema,
	type PublishRequest,
	type PublishResponse,
	type PublishStatusResponse,
} from '../../../publisher/protocol.ts';
import type { ZodType } from 'zod';

export class ClusterPublisherError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = 'ClusterPublisherError';
	}
}

export class ClusterPublisher {
	constructor(
		private readonly serviceUrl: string,
		private readonly apiKey: string,
	) {}

	private async request<T>(
		path: string,
		method: 'GET' | 'POST'|'DELETE',
		schema: ZodType<T>,
		body?: unknown,
	): Promise<T> {
		const response = await fetch(`${this.serviceUrl.replace(/\/$/, '')}${path}`, {
			method,
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});

		const text = await response.text();
		let payload: unknown;
		try {
			payload = text ? JSON.parse(text) : {};
		} catch {
			payload = { error: text };
		}

		if (!response.ok) {
			const message =
				typeof payload === 'object' && payload !== null && 'error' in payload
					? String((payload as { error: unknown }).error)
					: `the publisher answered ${response.status}`;
			throw new ClusterPublisherError(message, response.status);
		}

		const parsed = schema.safeParse(payload);
		if (!parsed.success || parsed.data === undefined) {
			throw new ClusterPublisherError('the publisher answered something unexpected', response.status);
		}
		return parsed.data;
	}

	/** Apply the app's stack, and wait for it to serve. */
	async publish(request: PublishRequest): Promise<PublishResponse> {
		const payload = PublishRequestSchema.parse(request);
		return this.request('/publish', 'POST', PublishResponseSchema, payload);
	}

	/** How the app is doing. */
	async status(appId: string): Promise<PublishStatusResponse> {
		return this.request(`/publish/${encodeURIComponent(appId)}`, 'GET', PublishStatusResponseSchema);
	}

	/** Take the app's stack away. */
	async unpublish(appId: string): Promise<PublishStatusResponse> {
		return this.request(`/publish/${encodeURIComponent(appId)}`, 'DELETE', PublishStatusResponseSchema);
	}
}
