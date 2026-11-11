import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * The builder's own tests.
 *
 * They run on Node — the service is a Node program — and they load the
 * application itself, so the aliases the Worker build resolves are resolved
 * here too, including "cloudflare:workers", which on Node is this
 * repository's platform.
 */
export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^cloudflare:workers$/,
				replacement: path.resolve(__dirname, 'builder/src/stubs/platform.ts'),
			},
			{
				find: 'artifacts-viewer/server/cache',
				replacement: path.resolve(
					__dirname,
					'./packages/artifacts-viewer/packages/artifacts-viewer/src/server/cache-adapters.ts',
				),
			},
			{
				find: /^artifacts-viewer$/,
				replacement: path.resolve(
					__dirname,
					'./packages/artifacts-viewer/packages/artifacts-viewer/src/index.ts',
				),
			},
			{ find: /^cloudflare:email$/, replacement: path.resolve(__dirname, 'builder/src/stubs/email.ts') },
			{ find: 'shared', replacement: path.resolve(__dirname, './shared') },
			{ find: 'worker', replacement: path.resolve(__dirname, './worker') },
		],
	},
	test: {
		globals: true,
		environment: 'node',
		include: ['builder/**/*.test.ts'],
		testTimeout: 30_000,
	},
});
