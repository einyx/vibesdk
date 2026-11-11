// The static assets, on Node.
//
// On Workers the SPA is a binding: `env.ASSETS.fetch(request)` answers with
// the file. Here the files are on the disk, in the directory the build put
// them in, and the same call answers with the same file.
//
// The application asks for a template that was shipped with the build
// (`/templates/template_catalog.json`), so a path that is not on the disk
// falls back to the index: the single-page application owns the routes it
// does not know about.

import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

const contentTypes: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.zip': 'application/zip',
	'.txt': 'text/plain; charset=utf-8',
	'.md': 'text/markdown; charset=utf-8',
};

const contentTypeFor = (file: string): string =>
	contentTypes[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

export class Assets {
	constructor(private readonly root: string) {}

	/** The file a request names, or the index for the application's routes. */
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const requested = decodeURIComponent(url.pathname);
		const candidate = path.join(this.root, requested);
		const resolved = path.resolve(candidate);

		// Never serve anything outside the assets directory.
		const root = path.resolve(this.root);
		if (!resolved.startsWith(root)) {
			return new Response('Not found', { status: 404 });
		}

		if (existsSync(resolved) && statSync(resolved).isFile()) {
			return this.file(resolved);
		}

		const index = path.join(root, 'index.html');
		if (existsSync(index)) {
			return this.file(index);
		}

		return new Response('Not found', { status: 404 });
	}

	/** One file, with its type. */
	private file(file: string): Response {
		const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
		return new Response(stream, {
			headers: {
				'content-type': contentTypeFor(file),
				'cache-control': file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
			},
		});
	}
}
