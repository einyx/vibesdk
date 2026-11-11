import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * The runtime's own tests.
 *
 * They load the Cloudflare `agents` SDK with the platform standing in for
 * "cloudflare:workers" — the same swap the module hook makes outside a
 * test. Node's pool, because the SDK is a server-side runtime and the
 * Workers pool has no filesystem to keep state in.
 */
export default defineConfig({
	resolve: {
		alias: {
			'cloudflare:workers': fileURLToPath(new URL('./runtime/src/platform.ts', import.meta.url)),
			'cloudflare:email': fileURLToPath(new URL('./runtime/src/email.ts', import.meta.url)),
		},
	},
	test: {
		globals: true,
		environment: 'node',
		include: ['runtime/**/*.test.ts'],
		server: {
			// The SDK is externalized by default, and an externalized
			// dependency keeps its own imports — so the alias would never
			// reach it. Inlining puts it through the resolver.
			deps: {
				inline: ['agents', 'partyserver', '@cloudflare/think'],
			},
		},
	},
});
