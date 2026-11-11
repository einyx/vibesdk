import { defineConfig } from 'vitest/config';

/**
 * The runner's own tests.
 *
 * The repository's main suite runs in the Workers pool, which has no
 * child processes — the runner spawns dev servers, so it needs the node
 * pool. Run with `npm run test:runner`.
 */
export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['runner/**/*.test.ts'],
	},
});
