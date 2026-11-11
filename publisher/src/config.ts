// Configuration, from the environment. The publisher runs one process that
// serves both faces of the Publisher API: the control plane (publish,
// status, unpublish) and the data plane (the deployed apps' traffic).
//
// PORT              API + proxy listen port (default 8080)
// API_KEY           required bearer token for the control plane
// NAMESPACE         the namespace the app stacks live in
// DATA_DIR          where the published bundles are kept (a PVC in k3s)
// PUBLISH_HOST      the host the deployed apps are served from
// APP_IMAGE         the image a deployed app runs
// BUNDLE_TOKEN_FILE the file the bundle-fetch token is read from
// KUBE_API_URL      the API server (the in-cluster service by default)

import { readFileSync } from 'node:fs'

function requireEnv(name: string): string {
	const value = process.env[name]
	if (!value || value.trim() === '') {
		console.error(`[config] missing required env ${name}`)
		process.exit(1)
	}
	return value.trim()
}

function intEnv(name: string, fallback: number): number {
	const value = Number(process.env[name])
	return Number.isFinite(value) && value > 0 ? value : fallback
}

function readTokenFile(path: string): string {
	return readFileSync(path, 'utf8').trim()
}

export const config = {
	port: intEnv('PORT', 8080),
	apiKey: requireEnv('API_KEY'),
	/** The namespace every app stack is applied in. */
	namespace: requireEnv('NAMESPACE'),
	dataDir: requireEnv('DATA_DIR'),
	/** The host the deployed apps are served from. */
	publishHost: requireEnv('PUBLISH_HOST').toLowerCase(),
	/** The image a deployed app runs: node, bun and wrangler. */
	appImage: requireEnv('APP_IMAGE'),
	/** The port the app's runtime listens on inside its pod. */
	appPort: intEnv('APP_PORT', 8080),
	/**
	 * The token the app's seed container fetches its bundle with. It is
	 * read from the mounted secret, not from the environment, so it never
	 * appears in a pod's description.
	 */
	bundleToken: (() => {
		const path = process.env.BUNDLE_TOKEN_FILE
		if (path && path.trim() !== '') return readTokenFile(path.trim())
		return requireEnv('BUNDLE_TOKEN')
	})(),
	/** The API server. The in-cluster service is the default. */
	kubeApiUrl: (process.env.KUBE_API_URL ?? 'https://kubernetes.default.svc').replace(/\/$/, ''),
	/** Where the service account's token lives. */
	kubeTokenFile: process.env.KUBE_TOKEN_FILE ?? '/var/run/secrets/kubernetes.io/serviceaccount/token',
	/** Body size cap for the publish request. */
	maxBodyBytes: intEnv('MAX_BODY_BYTES', 64 * 1024 * 1024),
	/** How long a publish waits for the app's pod to serve. */
	readyTimeoutMs: intEnv('READY_TIMEOUT_MS', 90_000),
	/** How often it checks while waiting. */
	readyPollMs: intEnv('READY_POLL_MS', 2_000),
	/** The CPU and memory an app's pod may use. */
	appCpuLimit: process.env.APP_CPU_LIMIT ?? '1',
	appMemoryLimit: process.env.APP_MEMORY_LIMIT ?? '1Gi',
	appCpuRequest: process.env.APP_CPU_REQUEST ?? '100m',
	appMemoryRequest: process.env.APP_MEMORY_REQUEST ?? '256Mi',
	/** The volume an app's Durable Object storage lives on. */
	appStorage: process.env.APP_STORAGE ?? '1Gi',
}
