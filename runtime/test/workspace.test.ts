import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NodeFileSystem } from '../src/workspace/fs.ts';
import { VolumeWorkspace, sanitizeAppId } from '../src/workspace/workspace.ts';

function volume(): string {
	return mkdtempSync(path.join(tmpdir(), 'vibesdk-volume-'));
}

describe('the filesystem on a volume', () => {
	it('writes and reads a file', async () => {
		const root = volume();
		const fs = new NodeFileSystem(path.join(root, 'app'));

		await fs.writeFile('/src/main.ts', 'export const x = 1\n');
		expect(await fs.readFile('/src/main.ts')).toBe('export const x = 1\n');
		expect(await fs.exists('/src/main.ts')).toBe(true);
		expect(await fs.exists('/src/nope.ts')).toBe(false);

		rmSync(root, { recursive: true, force: true });
	});

	it('does not let a path leave the app', async () => {
		const root = volume();
		const fs = new NodeFileSystem(path.join(root, 'app'));

		// A path that tries to climb out resolves inside the app: it never
		// reaches the file it names.
		await expect(fs.readFile('/../../etc/passwd')).rejects.toThrow(/ENOENT/);
		await fs.writeFile('../outside.txt', 'x');
		expect(await fs.exists('/outside.txt')).toBe(true);
		expect(await fs.exists('/app/outside.txt')).toBe(false);

		rmSync(root, { recursive: true, force: true });
	});

	it('reports a missing file as missing', async () => {
		const root = volume();
		const fs = new NodeFileSystem(path.join(root, 'app'));

		await expect(fs.stat('/nope')).rejects.toThrow(/ENOENT/);
		rmSync(root, { recursive: true, force: true });
	});

	it('lists, moves and removes', async () => {
		const root = volume();
		const fs = new NodeFileSystem(path.join(root, 'app'));

		await fs.writeFile('/a.txt', 'a');
		await fs.writeFile('/nested/b.txt', 'b');
		expect((await fs.readdir('/')).sort()).toEqual(['a.txt', 'nested']);

		await fs.mv('/a.txt', '/nested/a.txt');
		expect(await fs.exists('/a.txt')).toBe(false);
		expect(await fs.readFile('/nested/a.txt')).toBe('a');

		await fs.rm('/nested', { recursive: true });
		expect(await fs.exists('/nested')).toBe(false);

		rmSync(root, { recursive: true, force: true });
	});

	it('finds files by pattern', async () => {
		const root = volume();
		const fs = new NodeFileSystem(path.join(root, 'app'));

		await fs.writeFile('/src/main.ts', 'x');
		await fs.writeFile('/src/other.ts', 'x');
		await fs.writeFile('/readme.md', 'x');

		expect(await fs.glob('/src/*.ts')).toEqual(['/src/main.ts', '/src/other.ts']);
		rmSync(root, { recursive: true, force: true });
	});
});

describe('the workspace on a volume', () => {
	it('holds an app\'s files and its history', async () => {
		const root = volume();
		const workspace = new VolumeWorkspace({ root, appId: 'my-app' });
		await workspace.ready();

		await workspace.fs.writeFile('/src/main.ts', 'export const x = 1\n');
		const oid = await workspace.commit('first', { name: 'Prysm', email: 'dev@prysm.sh' });

		expect(oid).toBeTruthy();
		const history = await workspace.log();
		expect(history[0].message.trim()).toBe('first');
		expect(await workspace.fs.readFile('/src/main.ts')).toBe('export const x = 1\n');

		rmSync(root, { recursive: true, force: true });
	});

	it('keeps each app in its own directory', async () => {
		const root = volume();
		const one = new VolumeWorkspace({ root, appId: 'app-one' });
		const two = new VolumeWorkspace({ root, appId: 'app-two' });
		await one.ready();
		await two.ready();

		await one.fs.writeFile('/only-in-one.txt', 'x');
		expect(await one.fs.exists('/only-in-one.txt')).toBe(true);
		expect(await two.fs.exists('/only-in-one.txt')).toBe(false);

		rmSync(root, { recursive: true, force: true });
	});

	it('branches', async () => {
		const root = volume();
		const workspace = new VolumeWorkspace({ root, appId: 'my-app' });
		await workspace.ready();
		await workspace.fs.writeFile('/a.txt', 'a');
		await workspace.commit('first');

		await workspace.checkout('feature');
		await workspace.fs.writeFile('/b.txt', 'b');
		await workspace.commit('second');

		const { branches } = await workspace.branches();
		expect(branches.sort()).toEqual(['feature', 'main']);

		rmSync(root, { recursive: true, force: true });
	});

	it('finds the history again on the next session', async () => {
		const root = volume();

		const first = new VolumeWorkspace({ root, appId: 'my-app' });
		await first.ready();
		await first.fs.writeFile('/a.txt', 'a');
		await first.commit('remembered');

		// A new session over the same volume: the history is on disk.
		const second = new VolumeWorkspace({ root, appId: 'my-app' });
		await second.ready();
		const history = await second.log();
		expect(history[0].message.trim()).toBe('remembered');

		rmSync(root, { recursive: true, force: true });
	});

	it('names an app\'s directory safely', () => {
		expect(sanitizeAppId('My App')).toBe('my-app');
		expect(sanitizeAppId('../../etc')).toBe('etc');
		expect(sanitizeAppId('')).toBe('app');
	});
});
