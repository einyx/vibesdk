// The module hook that makes "cloudflare:workers" resolve.
//
// The `agents` SDK and `partyserver` import their base classes from
// "cloudflare:workers". On Node that specifier does not exist, so a
// resolve hook points it at this repository's platform instead: the SDK
// above it is Cloudflare's and runs unmodified.
//
// The hook is installed in-thread with `registerHooks`, which is
// synchronous — the SDK must not be imported before the hook is in place.

import { registerHooks, type ResolveHookSync } from 'node:module';
import { fileURLToPath } from 'node:url';

const platformUrl = new URL('./platform.ts', import.meta.url).href;
const emailUrl = new URL('./email.ts', import.meta.url).href;

/** The platform modules the SDK imports by their Cloudflare specifier. */
const MODULES: Record<string, string> = {
	'cloudflare:workers': platformUrl,
	'cloudflare:email': emailUrl,
};

let installed = false;

/** Point "cloudflare:workers" at this repository's platform. */
export function installHooks(): void {
	if (installed) return;
	installed = true;

	const resolve: ResolveHookSync = (specifier, context, nextResolve) => {
		const replacement = MODULES[specifier];
		if (replacement) {
			return { url: replacement, shortCircuit: true };
		}
		return nextResolve(specifier, context);
	};

	registerHooks({ resolve });
}

export { fileURLToPath };
