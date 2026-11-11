// The stack a published app is.
//
// One app, one stack: a Deployment that runs the app, a Service that
// reaches it, and a volume that holds the app's Durable Object storage.
// The bundle is fetched by an init container, so the pod starts with the
// app's files already in place.
//
// The stack is applied into one namespace, and the publisher's service
// account may do nothing else in the cluster.

import type { KubeGroup, KubeObject } from './kube.ts'

/**
 * The seed container's script.
 *
 * It fetches the published bundle over the cluster's own network and writes
 * it into the shared volume the app container reads. It is inline rather
 * than an image layer so that the app's runtime image carries nothing but
 * the runtime.
 */
export const SEED_SCRIPT = `
const fs = await import('node:fs');
const path = await import('node:path');
const response = await fetch(process.env.BUNDLE_URL, {
	headers: { authorization: 'Bearer ' + process.env.BUNDLE_TOKEN },
});
if (!response.ok) {
	console.error('the bundle could not be fetched: ' + response.status);
	process.exit(1);
}
const { files } = await response.json();
for (const file of files) {
	const target = path.join('/bundle', file.filePath);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, file.fileContents, 'utf8');
}
console.log('seeded ' + files.length + ' files');
`;

/** One object of the stack, and the resource it belongs to. */
export interface StackObject {
	group: KubeGroup;
	resource: string;
	object: KubeObject;
}

/** The resources an app's stack is made of, in the order they are applied. */
export const STACK_RESOURCES: { group: KubeGroup; resource: string }[] = [
	{ group: 'core', resource: 'persistentvolumeclaims' },
	{ group: 'core', resource: 'services' },
	{ group: 'apps', resource: 'deployments' },
];

/**
 * The objects an app's stack is made of, by name.
 *
 * The Deployment goes first: the app stops before its volume does, or the
 * volume stays bound to a pod that is on its way out.
 */
export function stackObjects(appId: string): { group: KubeGroup; resource: string; name: string }[] {
	return [
		{ group: 'apps', resource: 'deployments', name: appId },
		{ group: 'core', resource: 'services', name: appId },
		{ group: 'core', resource: 'persistentvolumeclaims', name: `${appId}-data` },
	];
}

export interface AppStackInput {
	/** The app's id: the objects are named after it. */
	appId: string;
	/** The app's name: the labels carry it. */
	name: string;
	namespace: string;
	/** The image the app runs: node, bun and wrangler. */
	image: string;
	/** Where the seed container fetches the bundle from. */
	bundleUrl: string;
	appPort: number;
	cpuLimit: string;
	memoryLimit: string;
	cpuRequest: string;
	memoryRequest: string;
	storage: string;
	/** The app's runtime environment. */
	env: Record<string, string>;
	/**
	 * The bundle's fingerprint. It is on the pod template, so a republished
	 * app gets a new pod: the bundle is fetched by the pod's init
	 * container, and a pod that stays is a pod with the old bundle.
	 */
	bundleHash: string;
	/** What was published, for the operator's eyes. */
	revision?: string;
}

function labels(appId: string, name: string, revision?: string): Record<string, string> {
	const result: Record<string, string> = {
		app: appId,
		'vibesdk.sh/app': appId,
		'vibesdk.sh/managed-by': 'publisher',
	};
	// A label value is not free text: it must start and end with an
	// alphanumeric character.
	const label = name
		.toLowerCase()
		.replace(/[^a-z0-9.-]+/g, '-')
		.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
		.slice(0, 63);
	if (label) result['vibesdk.sh/name'] = label;
	if (revision) result['vibesdk.sh/revision'] = revision.slice(0, 63);
	return result;
}

/**
 * The objects that make an app run.
 *
 * The order matters only for the reader: the volume and the service come
 * before the Deployment that uses them. Applying them is idempotent — a
 * republish replaces what is there.
 */
export function buildAppStack(input: AppStackInput): StackObject[] {
	const appId = input.appId;
	const volumeName = `${appId}-data`;
	const appLabels = labels(appId, input.name, input.revision);

	const volume: KubeObject = {
		apiVersion: 'v1',
		kind: 'PersistentVolumeClaim',
		metadata: {
			name: volumeName,
			namespace: input.namespace,
			labels: appLabels,
		},
		spec: {
			accessModes: ['ReadWriteOnce'],
			resources: {
				requests: { storage: input.storage },
			},
		},
	};

	const service: KubeObject = {
		apiVersion: 'v1',
		kind: 'Service',
		metadata: {
			name: appId,
			namespace: input.namespace,
			labels: appLabels,
		},
		spec: {
			type: 'ClusterIP',
			selector: { app: appId },
			ports: [
				{
					name: 'http',
					port: 80,
					targetPort: input.appPort,
					protocol: 'TCP',
				},
			],
		},
	};

	const deployment: KubeObject = {
		apiVersion: 'apps/v1',
		kind: 'Deployment',
		metadata: {
			name: appId,
			namespace: input.namespace,
			labels: appLabels,
		},
		spec: {
			replicas: 1,
			// The app's volume is ReadWriteOnce: two pods of the same app
			// cannot have it mounted at once, so a replacement waits for the
			// old one to go.
			strategy: { type: 'Recreate' },
			selector: { matchLabels: { app: appId } },
			template: {
				metadata: {
					labels: { app: appId },
					annotations: { 'vibesdk.sh/bundle': input.bundleHash },
				},
				spec: {
					// The app talks to nobody in the cluster.
					automountServiceAccountToken: false,
					initContainers: [
						{
							name: 'seed',
							image: input.image,
							imagePullPolicy: 'IfNotPresent',
							command: ['node', '--input-type=module', '-e', SEED_SCRIPT],
							env: [
								{ name: 'BUNDLE_URL', value: input.bundleUrl },
								{
									name: 'BUNDLE_TOKEN',
									valueFrom: {
										secretKeyRef: { name: 'vibesdk-apps-bundle-token', key: 'token' },
									},
								},
							],
							volumeMounts: [{ name: 'bundle', mountPath: '/bundle' }],
							resources: {
								requests: { cpu: '50m', memory: '128Mi' },
								limits: { cpu: '500m', memory: '512Mi' },
							},
						},
					],
					containers: [
						{
							name: 'app',
							image: input.image,
							imagePullPolicy: 'IfNotPresent',
							// The app is a Workers app: wrangler serves it with
							// workerd, which is the runtime the preview uses too.
							command: [
								'wrangler',
								'dev',
								'--ip',
								'0.0.0.0',
								'--port',
								String(input.appPort),
								'--persist-to',
								'/data',
								'--config',
								'/bundle/wrangler.json',
							],
							workingDir: '/bundle',
							env: [
								{ name: 'HOME', value: '/data' },
								{ name: 'NODE_ENV', value: 'production' },
								{ name: 'CI', value: 'true' },
								{ name: 'WRANGLER_SEND_METRICS', value: 'false' },
								...Object.entries(input.env).map(([name, value]) => ({ name, value })),
							],
							ports: [{ name: 'http', containerPort: input.appPort }],
							volumeMounts: [
								{ name: 'bundle', mountPath: '/bundle' },
								{ name: 'data', mountPath: '/data' },
							],
							resources: {
								requests: { cpu: input.cpuRequest, memory: input.memoryRequest },
								limits: { cpu: input.cpuLimit, memory: input.memoryLimit },
							},
							// The app's own routes are its business: the pod is
							// serving when the runtime answers, whatever it answers.
							readinessProbe: {
								tcpSocket: { port: input.appPort },
								initialDelaySeconds: 3,
								periodSeconds: 5,
							},
							livenessProbe: {
								tcpSocket: { port: input.appPort },
								initialDelaySeconds: 60,
								periodSeconds: 30,
							},
						},
					],
					volumes: [
						{ name: 'bundle', emptyDir: {} },
						{ name: 'data', persistentVolumeClaim: { claimName: volumeName } },
					],
				},
			},
		},
	};

	return [
		{ group: 'core', resource: 'persistentvolumeclaims', object: volume },
		{ group: 'core', resource: 'services', object: service },
		{ group: 'apps', resource: 'deployments', object: deployment },
	];
}
