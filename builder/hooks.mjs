// The resolve hook.
//
// Two Workers modules do not exist on Node: "cloudflare:workers" and
// "cloudflare:email". The first is this repository's platform — the Durable
// Object surface the agents SDK expects — and the second is a stub that
// says the host does not send email.
//
// The hook is registered before the application is loaded, so the SDKs that
// import these modules find them:
//
//   register('./hooks.mjs', import.meta.url);
//
// It lives beside the bundle it serves, and the paths beside it are the
// modules it points at.

import { existsSync } from 'node:fs';

/**
 * The module a specifier points at.
 *
 * The service is built into `dist`, where the modules are beside this hook;
 * in the sources they are one directory up. The first one that exists is
 * the one.
 */
const beside = (...candidates) => {
	for (const candidate of candidates) {
		const url = new URL(candidate, import.meta.url);
		if (existsSync(url)) return url.href;
	}
	return new URL(candidates[0], import.meta.url).href;
};

export async function resolve(specifier, context, nextResolve) {
	if (specifier === 'cloudflare:workers') {
		return {
			url: beside('./platform.mjs', './src/stubs/platform.ts'),
			shortCircuit: true,
		};
	}

	if (specifier === 'cloudflare:email') {
		return {
			url: beside('./email.mjs', './src/stubs/email.ts'),
			shortCircuit: true,
		};
	}

	// A relative import without an extension. The Workers runtime resolves
	// those the way a bundler does, and some packages are written that way;
	// Node's loader refuses. This is the same rule, and it is what lets the
	// Containers package load.
	if (specifier.startsWith('./') || specifier.startsWith('../')) {
		const base = new URL(specifier, context.parentURL);
		for (const suffix of ['.js', '.mjs', '/index.js', '/index.mjs']) {
			const candidate = new URL(`${base.href}${suffix}`);
			if (existsSync(candidate)) {
				return { url: candidate.href, shortCircuit: true };
			}
		}
	}

	return nextResolve(specifier, context);
}
