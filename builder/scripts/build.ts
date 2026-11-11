// The build.
//
// The application is written for the Workers runtime: TypeScript,
// extensionless imports, and the path aliases from tsconfig. Node wants
// plain JavaScript with explicit paths, so the bundle is what bridges the
// two.
//
//   "worker/*"          -> the repository's own paths, the way the tsconfig
//   "shared/*"            maps them
//   "artifacts-viewer"  -> the vendored sources, the way wrangler maps them
//   "cloudflare:workers" -> a runtime hook (see hooks.mjs)
//   "cloudflare:email"   -> a runtime hook
//
// The dependencies stay external: they are Node's to load, not the bundle's.
// The Workers modules are the exception — they are resolved at runtime, by
// the hook, so the SDK and the application share one platform instance.

import { build, type Loader, type Plugin } from 'esbuild';
import { copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const builder = path.resolve(root, 'builder');

const artifactsViewer = path.join(
	root,
	'packages/artifacts-viewer/packages/artifacts-viewer/src',
);

/** The aliases the Worker build resolves, resolved here. */
const aliases: Plugin = {
	name: 'aliases',
	setup(context) {
		context.onResolve({ filter: /^artifacts-viewer$/ }, () => ({
			path: path.join(artifactsViewer, 'index.ts'),
		}));

		context.onResolve({ filter: /^artifacts-viewer\/server\/cache$/ }, () => ({
			path: path.join(artifactsViewer, 'server/cache-adapters.ts'),
		}));

		context.onResolve({ filter: /^artifacts-viewer\/client$/ }, () => ({
			path: path.join(artifactsViewer, 'client/index.ts'),
		}));

		context.onResolve({ filter: /^artifacts-viewer\/react$/ }, () => ({
			path: path.join(artifactsViewer, 'react/index.ts'),
		}));

		// The skills are markdown, imported with `?raw`. The Worker's build
		// has a rule for them; here the query is dropped and the file is
		// loaded as text.
		context.onResolve({ filter: /\.md\?raw$/ }, async (args) =>
			context.resolve(args.path.replace(/\?raw$/, ''), {
				resolveDir: args.resolveDir,
				kind: args.kind,
			}),
		);
	},
};

const outdir = path.join(builder, 'dist');

const shared = {
	bundle: true,
	platform: 'node' as const,
	target: 'node24',
	format: 'esm' as const,
	sourcemap: true,
	logLevel: 'info' as const,
	loader: { '.md': 'text' as Loader },
	// The dependencies are Node's to load: they are CommonJS as often as
	// not, and their own requires have to keep working.
	packages: 'external' as const,
	external: ['cloudflare:workers', 'cloudflare:email'],
	// "worker/*" and "shared/*" are the repository's own paths, the way the
	// tsconfig maps them.
	nodePaths: [root],
	plugins: [aliases],
};

await build({
	...shared,
	entryPoints: [path.join(builder, 'src/index.ts'), path.join(builder, 'src/migrate.ts')],
	outdir,
	// The application is loaded with a dynamic import, so that the runtime
	// hook is registered before the Workers modules are resolved. Splitting
	// keeps that dynamic import dynamic: the application's own chunk is
	// loaded after the hook, not before it.
	splitting: true,
});

// The two modules the runtime hook points at, beside the bundle.
await build({
	...shared,
	entryPoints: [path.join(builder, 'src/stubs/platform.ts')],
	outfile: path.join(outdir, 'platform.mjs'),
});

await build({
	...shared,
	entryPoints: [path.join(builder, 'src/stubs/email.ts')],
	outfile: path.join(outdir, 'email.mjs'),
});

// The hook travels with the bundle: it is what makes the Workers modules
// resolve on Node.
copyFileSync(path.join(builder, 'hooks.mjs'), path.join(outdir, 'hooks.mjs'));
