import { defineConfig } from 'vitest/config';

/**
 * The publisher's own tests.
 *
 * The repository's main suite runs in the Workers pool, which has no
 * filesystem and no cluster: the publisher reads the environment and talks
 * to the API server, so it needs the node pool. Run with
 * `npm run test:publisher`.
 */
export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['publisher/**/*.test.ts'],
	},
});
