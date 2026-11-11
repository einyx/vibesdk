// The builder, on the host.
//
// The application is the same one the Worker runs: the same routes, the same
// contracts, the same code. What changes is where the platform's pieces come
// from — the database is a SQLite file, the key-value store is a table, the
// assets are a directory, and the sessions are the session runtime's.
//
// The order matters. The environment is installed before the application is
// loaded, because a module that reads the environment while it loads — the
// model's configuration does — would otherwise read nothing.

import { existsSync, mkdirSync } from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { missingRequirements, readConfig } from './config.ts';
import { attachSessionNamespaces, createHostEnv } from './env.ts';
import { createServer } from './server.ts';
import { Assets } from './storage/assets.ts';
import { openDatabase } from './storage/d1.ts';
import { SqliteKvStore } from './storage/kv.ts';

/**
 * The Workers modules.
 *
 * The SDKs import "cloudflare:workers" and "cloudflare:email"; on Node they
 * do not exist. The hook resolves them, and it has to be registered before
 * the application is loaded — which is why the imports below are dynamic.
 */
const registerWorkersModules = (): void => {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const hooks = path.join(here, 'hooks.mjs');
	if (!existsSync(hooks)) return;
	register(hooks, import.meta.url);
};

export interface BuilderHandle {
	/** The port the server answers on. */
	port: number;
	close: () => Promise<void>;
}

/** Start the service. */
export async function start(): Promise<BuilderHandle> {
	const config = readConfig();

	for (const directory of [
		path.dirname(config.databasePath),
		config.dataDir,
		config.sessionsDir,
	]) {
		mkdirSync(directory, { recursive: true });
	}

	const missing = missingRequirements(config);
	if (missing.length > 0) {
		console.warn('[builder] the service starts without these:');
		for (const item of missing) console.warn(`  - ${item}`);
	}

	const database = openDatabase(config.databasePath);
	const kv = new SqliteKvStore(database.raw());
	const assets = new Assets(config.assetsDir);
	const hostEnv = createHostEnv(config, { database, kv, assets });

	// The ambient environment, before anything is loaded.
	registerWorkersModules();
	const { setAmbientEnv } = await import('../../runtime/src/env.ts');
	setAmbientEnv(hostEnv as unknown as Record<string, unknown>);

	// The sessions and the application.
	const { SessionRuntime } = await import('../../runtime/src/session.ts');
	const { CodeGeneratorAgent } = await import('../../worker/agents/core/codingAgent.ts');
	const { ThinkAgent } = await import('../../worker/agents/think/ThinkAgent.ts');
	const { UserSecretsStore } = await import('../../worker/services/secrets/UserSecretsStore.ts');
	const { DORateLimitStore } = await import('../../worker/services/rate-limit/DORateLimitStore.ts');
	const { createApp } = await import('../../worker/app.ts');

	const sessions = new SessionRuntime({
		dataDir: config.sessionsDir,
		env: hostEnv as unknown as Record<string, unknown>,
	});

	attachSessionNamespaces(hostEnv, {
		CodeGenObject: sessions.register(CodeGeneratorAgent as never),
		THINK_DO: sessions.register(ThinkAgent as never),
		UserSecretsStore: sessions.register(UserSecretsStore as never),
		DORateLimitStore: sessions.register(DORateLimitStore as never),
	});

	const server = createServer({
		fetch: (request, env, ctx) => createApp(env).fetch(request, env, ctx),
		env: hostEnv,
		assets,
		origin: `http://${config.host}:${config.port}`,
		sessions,
	});

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(config.port, config.host, () => resolve());
	});

	const address = server.address();
	const port = typeof address === 'object' && address !== null ? address.port : config.port;

	console.log(`[builder] listening on http://${config.host}:${port}`);

	return {
		port,
		close: async () => {
			await new Promise<void>((resolve) => server.close(() => resolve()));
			sessions.close();
			database.raw().close();
		},
	};
}

if (import.meta.main) {
	await start();
}
