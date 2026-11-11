/**
 * The instance registry's behaviour on the volume.
 *
 * The service runs on node and reads its configuration from the
 * environment, so the environment is set before the modules are imported —
 * an import is hoisted above any statement in this file.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'vibesdk-runner-test-'));
process.env.API_KEY = 'test-api-key';
process.env.DATA_DIR = dataDir;
process.env.RUNNER_HOST = 'runner.test';

const { adoptInstance, evictIdleInstances } = await import('../src/instances.ts');

/** An instance as a previous pod left it on the volume. */
function leaveInstance(id: string, lastAccessedAt: number): void {
	const dir = join(dataDir, 'instances', id);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, 'instance.json'),
		JSON.stringify({
			id,
			port: 4173,
			projectName: 'Todos',
			initCommand: 'bun run dev',
			envVars: {},
			createdAt: new Date(Date.now() - 60_000).toISOString(),
			lastAccessedAt,
		}),
		'utf8',
	);
}

describe('adopting an instance from the volume', () => {
	it('counts as an access, so the sweep does not evict it', async () => {
		// An instance nobody has asked for in an hour.
		const stale = Date.now() - 60 * 60 * 1000;
		leaveInstance('stale-one', stale);

		const adopted = await adoptInstance('stale-one');

		expect(adopted).not.toBeNull();
		// The pod is reviving it because it was asked for: the timestamp it
		// was last asked for is not the one that matters now.
		expect(Date.now() - (adopted?.lastAccessedAt ?? 0)).toBeLessThan(5000);
	});

	it('leaves an adopted instance alone when the sweep runs', async () => {
		leaveInstance('stale-two', Date.now() - 60 * 60 * 1000);
		await adoptInstance('stale-two');

		await evictIdleInstances();

		// Still there: the preview survived the rollout that revived it.
		const again = await adoptInstance('stale-two');
		expect(again).not.toBeNull();
	});
});
