// The environment the application sees on the host.
//
// The Worker gets its environment from the binding table; the host builds
// the same shape from the configuration and the adapters. The names are the
// Worker's own, so the application does not change.
//
// The object is filled in twice: the variables first, so that a module
// which reads the environment while it loads sees them, and the session
// namespaces afterwards, because those need the Durable Object classes, and
// loading those is what the environment is for.

import type { BuilderConfig } from './config.ts';
import type { Assets } from './storage/assets.ts';
import type { D1Database } from './storage/d1.ts';
import type { KvStore } from './storage/kv.ts';

export interface HostAdapters {
	database: D1Database;
	kv: KvStore;
	assets: Assets;
}

/** The environment: the variables, the secrets and the adapters. */
export function createHostEnv(config: BuilderConfig, adapters: HostAdapters): Env {
	return {
		// --- The origin ---
		CUSTOM_DOMAIN: config.customDomain,
		CUSTOM_PREVIEW_DOMAIN: '',
		ENVIRONMENT: config.environment,

		// --- Identity ---
		JWT_SECRET: config.jwtSecret,
		LOGTO_ISSUER: config.logtoIssuer,
		LOGTO_CLIENT_ID: config.logtoClientId,
		LOGTO_CLIENT_SECRET: config.logtoClientSecret,

		// --- The cluster ---
		SANDBOX_SERVICE_TYPE: config.sandboxServiceType,
		SANDBOX_SERVICE_URL: config.sandboxServiceUrl,
		SANDBOX_SERVICE_API_KEY: config.sandboxServiceApiKey,
		PUBLISH_SERVICE_URL: config.publishServiceUrl,
		PUBLISH_SERVICE_API_KEY: config.publishServiceApiKey,

		// --- Models ---
		GLM_API_KEY: config.glmApiKey,
		PLATFORM_MODEL_PROVIDERS: config.platformModelProviders,

		// --- The browser ---
		DEV_BROWSER_SIDECAR_URL: config.sidecarUrl,

		// --- Templates ---
		TEMPLATES_REPOSITORY: config.templatesRepository,
		MAX_SANDBOX_INSTANCES: String(config.maxSandboxInstances),

		// --- Storage ---
		DB: adapters.database,
		VibecoderStore: adapters.kv,
		ASSETS: adapters.assets,
	} as unknown as Env;
}

/**
 * The session namespaces.
 *
 * On Workers these are Durable Object namespaces. Here they are the session
 * runtime's namespaces: the same address (`idFromName`, `get`, `getByName`),
 * the same sessions, on this process's disk.
 */
export function attachSessionNamespaces(env: Env, namespaces: Record<string, unknown>): Env {
	Object.assign(env, namespaces);
	return env;
}
