// The workspace, on a volume.
//
// A workspace is a directory of files and a git history over it. Today it
// is a Durable Object with `@cloudflare/shell`'s `Workspace` over DO SQLite,
// with Cloudflare Artifacts as the remote. On a volume it is a directory
// and a git repository, and the same code works: the git is isomorphic-git
// over a `FileSystem`, and the filesystem is the one in this directory.
//
// One app, one volume. The session that owns the app mounts it.

import { FileSystemStateBackend } from '@cloudflare/shell';
import { createGit, type Git } from '@cloudflare/shell/git';
import path from 'node:path';
import { NodeFileSystem } from './fs.ts';

export interface VolumeWorkspaceOptions {
	/** Where the volumes are mounted. */
	root: string;
	/** The app's id: its directory's name. */
	appId: string;
	/** The git remote, when there is one. */
	remote?: { name: string; url: string; token?: string };
}

export class VolumeWorkspace {
	readonly directory: string;
	readonly fs: NodeFileSystem;
	readonly git: Git;
	readonly stateBackend: FileSystemStateBackend;
	private readonly remote: VolumeWorkspaceOptions['remote'];

	constructor(options: VolumeWorkspaceOptions) {
		this.remote = options.remote;
		this.directory = path.join(options.root, sanitizeAppId(options.appId));
		this.fs = new NodeFileSystem(this.directory);
		this.git = createGit(this.fs);
		this.stateBackend = new FileSystemStateBackend(this.fs);
	}

	/** The app's directory, ready to be used. */
	async ready(): Promise<void> {
		if (!(await this.fs.exists('/.git'))) {
			await this.git.init({ dir: '/', defaultBranch: 'main' });
		}
		if (this.remote) {
			const remotes = await this.git.remote({ list: true, dir: '/' });
			const known = Array.isArray(remotes)
				? remotes.some((entry) => 'name' in entry && entry.name === this.remote?.name)
				: false;
			if (!known) {
				await this.git.remote({ add: this.remote, dir: '/' });
			}
		}
	}

	/** The app's files, as the workspace's own paths. */
	async list(path = '/'): Promise<string[]> {
		const entries = await this.fs.readdirWithFileTypes(path);
		return entries.map((entry) => entry.name);
	}

	/** Commit everything in the workspace. */
	async commit(message: string, author?: { name: string; email: string }): Promise<string> {
		await this.git.add({ filepath: '.', dir: '/' });
		const result = await this.git.commit({ message, author, dir: '/' });
		return result.oid;
	}

	/** The history, newest first. */
	async log(depth = 10, ref?: string): Promise<{ oid: string; message: string }[]> {
		const entries = await this.git.log({ depth, ref, dir: '/' });
		return entries.map((entry) => ({ oid: entry.oid, message: entry.message }));
	}

	/** The branches, and which one is checked out. */
	async branches(): Promise<{ branches: string[]; current?: string }> {
		const result = await this.git.branch({ list: true, dir: '/' });
		return { branches: result.branches ?? [], current: result.current || undefined };
	}

	/** Check a branch out, creating it when it is not there. */
	async checkout(branch: string): Promise<void> {
		await this.git.checkout({ branch, dir: '/' });
	}

	/** Push a branch to the remote. */
	async push(branch: string): Promise<boolean> {
		if (!this.remote) return false;
		const result = await this.git.push({
			remote: this.remote.name,
			ref: branch,
			force: true,
			dir: '/',
			token: this.remote.token,
		});
		return result.ok;
	}

	/** Fetch a branch from the remote. */
	async fetch(branch: string): Promise<void> {
		if (!this.remote) return;
		await this.git.fetch({
			remote: this.remote.name,
			ref: branch,
			dir: '/',
			token: this.remote.token,
		});
	}
}

/** An app's id is a directory name: lowercase, and no separators. */
export function sanitizeAppId(raw: string): string {
	const cleaned = raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
	return cleaned || 'app';
}
