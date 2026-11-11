// The ambient environment, for Node.
//
// On Cloudflare `import { env } from "cloudflare:workers"` reads the
// worker's binding table: D1, KV, R2, the AI binding, the browser. Here it
// reads whatever the runtime was handed, and unknown bindings are simply
// absent — which is what the SDK's `if (env.AI)` guards expect.

export interface AmbientEnv {
	[key: string]: unknown;
}

/**
 * The environment the SDK reads.
 *
 * It is on the global, not in the module: the platform can be reached
 * through more than one path — the runtime imports it directly, the SDK
 * imports it as "cloudflare:workers", and the builder's bundle carries its
 * own copy — and those are the same module in Node, but not necessarily in
 * a bundle's world.
 */
const store = (globalThis as { __vibesdkAmbientEnv?: { current: AmbientEnv } }).__vibesdkAmbientEnv ??=
	{ current: {} };

/** Replace the ambient environment. */
export function setAmbientEnv(env: AmbientEnv): void {
	store.current = env;
}

/**
 * The environment, as a proxy.
 *
 * A proxy rather than a plain object: the SDK asks for bindings it may not
 * have, and a missing binding should read as undefined instead of throwing.
 */
export const ambientEnv: AmbientEnv = new Proxy({} as AmbientEnv, {
	get(_target, property: string) {
		return store.current[property];
	},
	has(_target, property: string) {
		return property in store.current;
	},
	ownKeys() {
		return Reflect.ownKeys(store.current);
	},
	getOwnPropertyDescriptor(_target, property: string) {
		const value = store.current[property];
		if (value === undefined) return undefined;
		return { value, enumerable: true, configurable: true, writable: true };
	},
});
