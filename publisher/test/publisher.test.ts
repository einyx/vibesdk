import { describe, expect, it } from 'vitest';
import { buildAppStack, stackObjects, STACK_RESOURCES, type StackObject } from '../src/stack.ts';
import { rewriteRootPaths } from '../src/proxy.ts';

const input = {
	appId: 'my-app',
	name: 'My App',
	namespace: 'vibesdk-apps',
	image: 'vibesdk-app-runtime:latest',
	bundleUrl: 'http://publisher.vibesdk-apps.svc.cluster.local/bundles/my-app',
	appPort: 8080,
	cpuLimit: '1',
	memoryLimit: '1Gi',
	cpuRequest: '100m',
	memoryRequest: '256Mi',
	storage: '1Gi',
	env: { GREETING: 'hello' },
	bundleHash: 'abc123',
};

function stack(): StackObject[] {
	return buildAppStack(input);
}

/** The app's container, as the Deployment carries it. */
function container(): Record<string, unknown> {
	const deployment = stack().find((entry) => entry.resource === 'deployments');
	const spec = deployment?.object.spec as Record<string, unknown>;
	const template = spec.template as Record<string, unknown>;
	const podSpec = template.spec as Record<string, unknown>;
	const containers = podSpec.containers as Record<string, unknown>[];
	return containers[0];
}

/** The pod's spec, as the Deployment carries it. */
function podSpec(): Record<string, unknown> {
	const deployment = stack().find((entry) => entry.resource === 'deployments');
	const spec = deployment?.object.spec as Record<string, unknown>;
	const template = spec.template as Record<string, unknown>;
	return template.spec as Record<string, unknown>;
}

describe('the stack', () => {
	it('is a volume, a service and a deployment', () => {
		expect(stack().map((entry) => entry.resource)).toEqual([
			'persistentvolumeclaims',
			'services',
			'deployments',
		]);
		expect(stack().map((entry) => entry.resource)).toEqual(
			STACK_RESOURCES.map((entry) => entry.resource),
		);
	});

	it('names every object after the app', () => {
		const names = stack().map((entry) => entry.object.metadata.name);
		expect(names).toEqual(['my-app-data', 'my-app', 'my-app']);
		for (const entry of stack()) {
			expect(entry.object.metadata.namespace).toBe('vibesdk-apps');
		}
	});

	it('takes the stack away by the same names it applied it under', () => {
		expect(stackObjects('my-app')).toEqual([
			{ group: 'apps', resource: 'deployments', name: 'my-app' },
			{ group: 'core', resource: 'services', name: 'my-app' },
			{ group: 'core', resource: 'persistentvolumeclaims', name: 'my-app-data' },
		]);
	});

	it('runs the app with the runtime that serves a Workers app', () => {
		const command = (container().command as string[]).join(' ');
		expect(command).toContain('wrangler');
		expect(command).toContain('--persist-to');
		expect(container().workingDir).toBe('/bundle');
	});

	it('gives the app the environment it was published with', () => {
		expect(container().env).toContainEqual({ name: 'GREETING', value: 'hello' });
	});

	it('seeds the bundle before the app starts', () => {
		const initContainers = podSpec().initContainers as Record<string, unknown>[];
		expect(initContainers).toHaveLength(1);
		expect(initContainers[0].command).toContain('node');
		expect(podSpec().automountServiceAccountToken).toBe(false);
	});

	it('carries the bundle fingerprint on the pod, so a republish gets a new pod', () => {
		const deployment = stack().find((entry) => entry.resource === 'deployments');
		const spec = deployment?.object.spec as Record<string, unknown>;
		const template = spec.template as Record<string, unknown>;
		const metadata = template.metadata as Record<string, unknown>;
		expect(metadata.annotations).toEqual({ 'vibesdk.sh/bundle': 'abc123' });
	});
});

describe('the root paths', () => {
	it('makes an asset path relative to the page', () => {
		expect(rewriteRootPaths('<link href="/style.css">', 'text/html')).toBe(
			'<link href="style.css">',
		);
		expect(rewriteRootPaths('<img src="/logo.png">', 'text/html')).toBe(
			'<img src="logo.png">',
		);
	});

	it('leaves absolute urls alone', () => {
		expect(rewriteRootPaths('<a href="https://example.com/x">', 'text/html')).toBe(
			'<a href="https://example.com/x">',
		);
		expect(rewriteRootPaths('<a href="//cdn.example.com/x">', 'text/html')).toBe(
			'<a href="//cdn.example.com/x">',
		);
	});

	it('rewrites a css url', () => {
		expect(rewriteRootPaths('background: url(/bg.png)', 'text/css')).toBe(
			'background: url(bg.png)',
		);
	});

	it('leaves other bodies alone', () => {
		expect(rewriteRootPaths('{"href":"/x"}', 'application/json')).toBe('{"href":"/x"}');
	});
});
