// The filesystem, on a volume.
//
// `@cloudflare/shell` describes a filesystem as seventeen methods over a
// rooted path space: "/src/main.ts" means the file at the root's src, and
// nothing outside the root is reachable. This is that filesystem, over
// Node's own.
//
// The git, the workspace and the state backend are all written against
// this interface, so they move to a volume without changing.

import { mkdirSync } from 'node:fs';
import {
	appendFile,
	cp as fsCp,
	lstat as fsLstat,
	mkdir as fsMkdir,
	readFile as fsReadFile,
	readdir as fsReaddir,
	readlink as fsReadlink,
	realpath as fsRealpath,
	rm as fsRm,
	rename as fsRename,
	stat as fsStat,
	symlink as fsSymlink,
	writeFile as fsWriteFile,
} from 'node:fs/promises';
import path from 'node:path';

export interface FsStat {
	type: 'file' | 'directory' | 'symlink';
	size: number;
	mtime: Date;
	mode?: number;
}

export interface FileSystemDirent {
	name: string;
	type: 'file' | 'directory' | 'symlink';
}

/** The filesystem interface `@cloudflare/shell` speaks. */
export interface FileSystem {
	readFile(path: string): Promise<string>;
	readFileBytes(path: string): Promise<Uint8Array>;
	writeFile(path: string, content: string): Promise<void>;
	writeFileBytes(path: string, content: Uint8Array): Promise<void>;
	appendFile(path: string, content: string | Uint8Array): Promise<void>;
	exists(path: string): Promise<boolean>;
	stat(path: string): Promise<FsStat>;
	lstat(path: string): Promise<FsStat>;
	mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
	readdir(path: string): Promise<string[]>;
	readdirWithFileTypes(path: string): Promise<FileSystemDirent[]>;
	rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
	cp(src: string, dest: string, options?: { recursive?: boolean }): Promise<void>;
	mv(src: string, dest: string): Promise<void>;
	symlink(target: string, linkPath: string): Promise<void>;
	readlink(path: string): Promise<string>;
	realpath(path: string): Promise<string>;
	resolvePath(base: string, path: string): string;
	glob(pattern: string): Promise<string[]>;
}

function enoent(target: string): NodeJS.ErrnoException {
	const error: NodeJS.ErrnoException = new Error(`ENOENT: no such file or directory, '${target}'`);
	error.code = 'ENOENT';
	error.path = target;
	return error;
}

/**
 * A filesystem rooted at a directory.
 *
 * The root is the app's directory on the volume: one app, one directory,
 * one volume.
 */
export class NodeFileSystem implements FileSystem {
	constructor(private readonly root: string) {
		mkdirSync(this.root, { recursive: true });
	}

	/** The directory this filesystem is rooted at. */
	get base(): string {
		return this.root;
	}

	/**
	 * Where a path in the filesystem's space is on disk.
	 *
	 * A path that would leave the root is refused: the workspace holds
	 * generated code, and generated code is not allowed to reach outside
	 * its own app.
	 */
	private resolve(target: string): string {
		const normalized = path.posix.normalize(target.startsWith('/') ? target : `/${target}`);
		if (normalized === '/..' || normalized.startsWith('/../')) {
			throw new Error(`the path leaves the workspace: ${target}`);
		}
		const resolved = path.resolve(this.root, `.${normalized}`);
		if (resolved !== this.root && !resolved.startsWith(this.root + path.sep)) {
			throw new Error(`the path leaves the workspace: ${target}`);
		}
		return resolved;
	}

	async readFile(target: string): Promise<string> {
		try {
			return await fsReadFile(this.resolve(target), 'utf8');
		} catch (error) {
			throw this.asEnoent(error, target);
		}
	}

	async readFileBytes(target: string): Promise<Uint8Array> {
		try {
			const content = await fsReadFile(this.resolve(target));
			return new Uint8Array(content);
		} catch (error) {
			throw this.asEnoent(error, target);
		}
	}

	async writeFile(target: string, content: string): Promise<void> {
		const resolved = this.resolve(target);
		await fsMkdir(path.dirname(resolved), { recursive: true });
		await fsWriteFile(resolved, content, 'utf8');
	}

	async writeFileBytes(target: string, content: Uint8Array): Promise<void> {
		const resolved = this.resolve(target);
		await fsMkdir(path.dirname(resolved), { recursive: true });
		await fsWriteFile(resolved, content);
	}

	async appendFile(target: string, content: string | Uint8Array): Promise<void> {
		const resolved = this.resolve(target);
		await fsMkdir(path.dirname(resolved), { recursive: true });
		await appendFile(resolved, content);
	}

	async exists(target: string): Promise<boolean> {
		try {
			await fsStat(this.resolve(target));
			return true;
		} catch {
			return false;
		}
	}

	async stat(target: string): Promise<FsStat> {
		try {
			return toStat(await fsStat(this.resolve(target)));
		} catch (error) {
			throw this.asEnoent(error, target);
		}
	}

	async lstat(target: string): Promise<FsStat> {
		try {
			return toStat(await fsLstat(this.resolve(target)));
		} catch (error) {
			throw this.asEnoent(error, target);
		}
	}

	async mkdir(target: string, options?: { recursive?: boolean }): Promise<void> {
		await fsMkdir(this.resolve(target), { recursive: options?.recursive ?? false });
	}

	async readdir(target: string): Promise<string[]> {
		try {
			return await fsReaddir(this.resolve(target));
		} catch (error) {
			throw this.asEnoent(error, target);
		}
	}

	async readdirWithFileTypes(target: string): Promise<FileSystemDirent[]> {
		try {
			const entries = await fsReaddir(this.resolve(target), { withFileTypes: true });
			return entries.map((entry) => ({
				name: entry.name,
				type: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file',
			}));
		} catch (error) {
			throw this.asEnoent(error, target);
		}
	}

	async rm(target: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
		await fsRm(this.resolve(target), {
			recursive: options?.recursive ?? false,
			force: options?.force ?? false,
		});
	}

	async cp(src: string, dest: string, options?: { recursive?: boolean }): Promise<void> {
		await fsCp(this.resolve(src), this.resolve(dest), { recursive: options?.recursive ?? true });
	}

	async mv(src: string, dest: string): Promise<void> {
		const resolved = this.resolve(dest);
		await fsMkdir(path.dirname(resolved), { recursive: true });
		await fsRename(this.resolve(src), resolved);
	}

	async symlink(target: string, linkPath: string): Promise<void> {
		const resolved = this.resolve(linkPath);
		await fsMkdir(path.dirname(resolved), { recursive: true });
		await fsSymlink(target, resolved);
	}

	async readlink(target: string): Promise<string> {
		try {
			return await fsReadlink(this.resolve(target));
		} catch (error) {
			throw this.asEnoent(error, target);
		}
	}

	async realpath(target: string): Promise<string> {
		try {
			const resolved = await fsRealpath(this.resolve(target));
			return `/${path.relative(this.root, resolved).split(path.sep).join('/')}`;
		} catch (error) {
			throw this.asEnoent(error, target);
		}
	}

	resolvePath(base: string, target: string): string {
		if (target.startsWith('/')) return path.posix.normalize(target);
		return path.posix.normalize(path.posix.join(base, target));
	}

	async glob(pattern: string): Promise<string[]> {
		const matches: string[] = [];
		await this.walk('/', async (entry) => {
			if (matchesGlob(entry, pattern)) matches.push(entry);
		});
		return matches.sort();
	}

	/** Every file and directory under a path, depth first. */
	private async walk(target: string, visit: (entry: string) => Promise<void>): Promise<void> {
		let entries: FileSystemDirent[];
		try {
			entries = await this.readdirWithFileTypes(target);
		} catch {
			return;
		}
		for (const entry of entries) {
			const entryPath = target === '/' ? `/${entry.name}` : `${target}/${entry.name}`;
			await visit(entryPath);
			if (entry.type === 'directory') await this.walk(entryPath, visit);
		}
	}

	private asEnoent(error: unknown, target: string): NodeJS.ErrnoException {
		if (error && typeof error === 'object' && 'code' in error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === 'ENOENT') return enoent(target);
		}
		return error as NodeJS.ErrnoException;
	}
}

function toStat(stats: { isDirectory(): boolean; isSymbolicLink(): boolean; size: number; mtime: Date; mode: number }): FsStat {
	return {
		type: stats.isDirectory() ? 'directory' : stats.isSymbolicLink() ? 'symlink' : 'file',
		size: stats.size,
		mtime: stats.mtime,
		mode: stats.mode,
	};
}

/** Whether a path matches a glob pattern. */
function matchesGlob(target: string, pattern: string): boolean {
	const patternParts = pattern.split('/').filter((part) => part !== '');
	const targetParts = target.split('/').filter((part) => part !== '');
	if (patternParts.length > targetParts.length) return false;

	return patternParts.every((part, index) => {
		if (part === '**') return true;
		return part.startsWith('*')
			? targetParts[index]?.endsWith(part.slice(1))
			: part.startsWith('*')
				? targetParts[index]?.startsWith(part.slice(0, -1))
				: part === targetParts[index];
	});
}
