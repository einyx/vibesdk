// The Kubernetes API, from the publisher.
//
// The publisher talks to the API server directly: no client library, no
// dependencies, one fetch per call. The service account's token and the
// cluster's CA are the ones kubelet mounts into the pod, and Node trusts
// the CA through NODE_EXTRA_CA_CERTS (set on the container).

import { readFileSync } from 'node:fs'

export interface KubeMetadata {
	name: string;
	namespace?: string;
	labels?: Record<string, string>;
	annotations?: Record<string, string>;
	resourceVersion?: string;
	uid?: string;
	[key: string]: unknown;
}

export interface KubeObject {
	apiVersion: string;
	kind: string;
	metadata: KubeMetadata;
	[key: string]: unknown;
}

export type KubeGroup = 'core' | 'apps'

export interface KubeResult {
	status: number;
	body: unknown;
}

/** The fields the API server owns and will not take back on an update. */
const PRESERVED_ON_UPDATE: Record<string, string[]> = {
	services: ['clusterIP', 'clusterIPs', 'ipFamilies', 'ipFamilyPolicy', 'healthCheckNodePort', 'nodePorts'],
	persistentvolumeclaims: [],
	deployments: [],
};

/**
 * A client for the API server.
 *
 * The token is read per request: kubelet rotates it, and a long-lived
 * publisher would otherwise talk to the API server with a token that has
 * expired.
 */
export class KubeClient {
	private readonly baseUrl: string;
	private readonly tokenFile: string;

	constructor(baseUrl: string, tokenFile: string) {
		this.baseUrl = baseUrl;
		this.tokenFile = tokenFile;
	}

	private token(): string {
		return readFileSync(this.tokenFile, 'utf8').trim();
	}

	async request(method: string, path: string, body?: unknown): Promise<KubeResult> {
		const response = await fetch(`${this.baseUrl}${path}`, {
			method,
			headers: {
				authorization: `Bearer ${this.token()}`,
				...(body === undefined ? {} : { 'content-type': 'application/json' }),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const text = await response.text();
		let parsed: unknown;
		if (text) {
			try {
				parsed = JSON.parse(text);
			} catch {
				parsed = text;
			}
		}
		return { status: response.status, body: parsed };
	}

	private resourcePath(group: KubeGroup, namespace: string, resource: string, name?: string): string {
		const prefix = group === 'core' ? '/api/v1' : '/apis/apps/v1';
		const base = `${prefix}/namespaces/${namespace}/${resource}`;
		return name ? `${base}/${name}` : base;
	}

	/** The object, or null when it does not exist. */
	async get(group: KubeGroup, namespace: string, resource: string, name: string): Promise<KubeObject | null> {
		const result = await this.request('GET', this.resourcePath(group, namespace, resource, name));
		if (result.status === 404) return null;
		if (result.status >= 400) {
			throw new Error(`${resource}/${name}: ${describe(result.body)}`);
		}
		return result.body as KubeObject;
	}

	/**
	 * Create the object, or replace the one that is there.
	 *
	 * A replacement carries the existing resource version and the fields
	 * the API server owns: a Service's cluster IP is assigned once and
	 * cannot be changed, and a volume's spec is immutable.
	 *
	 * The API server's PUT is an update and answers 404 for an object that
	 * is not there, so a first apply is a POST to the collection.
	 */
	async apply(group: KubeGroup, namespace: string, resource: string, object: KubeObject): Promise<KubeObject> {
		const existing = await this.get(group, namespace, resource, object.metadata.name);
		const body: KubeObject = structuredClone(object);

		if (!existing) {
			const created = await this.request(
				'POST',
				this.resourcePath(group, namespace, resource),
				body,
			);
			if (created.status >= 400) {
				throw new Error(`${resource}/${object.metadata.name}: ${describe(created.body)}`);
			}
			return created.body as KubeObject;
		}

		body.metadata.resourceVersion = existing.metadata.resourceVersion;
		const existingSpec = (existing.spec ?? {}) as Record<string, unknown>;
		const spec = (body.spec ?? {}) as Record<string, unknown>;
		for (const field of PRESERVED_ON_UPDATE[resource] ?? []) {
			if (existingSpec[field] !== undefined) spec[field] = existingSpec[field];
		}
		if (resource === 'persistentvolumeclaims') {
			// The volume's spec is immutable: keep the one that exists.
			body.spec = existingSpec;
		}

		const result = await this.request(
			'PUT',
			this.resourcePath(group, namespace, resource, object.metadata.name),
			body,
		);
		if (result.status >= 400) {
			throw new Error(`${resource}/${object.metadata.name}: ${describe(result.body)}`);
		}
		return result.body as KubeObject;
	}

	/** Delete the object. Whether it was there is not an error. */
	async remove(group: KubeGroup, namespace: string, resource: string, name: string): Promise<boolean> {
		const result = await this.request('DELETE', this.resourcePath(group, namespace, resource, name));
		if (result.status === 404) return false;
		if (result.status >= 400) {
			throw new Error(`${resource}/${name}: ${describe(result.body)}`);
		}
		return true;
	}
}

/** The API server's own words about what went wrong. */
export function describe(body: unknown): string {
	if (typeof body === 'string') return body;
	if (typeof body !== 'object' || body === null) return String(body);
	const record = body as Record<string, unknown>;
	if (typeof record.message === 'string') return record.message;
	return JSON.stringify(body);
}
