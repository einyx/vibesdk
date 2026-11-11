// The ambient environment, for Node.
//
// On Cloudflare `import { env } from "cloudflare:workers"` reads the
// worker's binding table: D1, KV, R2, the AI binding, the browser. Here it
// reads whatever the runtime was handed, and unknown bindings are simply
// absent — which is what the SDK's `if (env.AI)` guards expect.

export interface AmbientEnv {
	[key: string]: unknown;
}

let current: AmbientEnv = {};

/** Replace the ambient environment. */
export function setAmbientEnv(env: AmbientEnv): void {
	current = env;
}

/**
 * The environment the SDK reads.
 *
 * A proxy rather than a plain object: the SDK asks for bindings it may not
 * have, and a missing binding should read as undefined instead of throwing.
 */
export const ambientEnv: AmbientEnv = new Proxy({} as AmbientEnv, {
	get(_target, property: string) {
		return current[property];
	},
	has(_target, property: string) {
		return property in current;
	},
	ownKeys() {
		return Reflect.ownKeys(current);
	},
	getOwnPropertyDescriptor(_target, property: string) {
		const value = current[property];
		if (value === undefined) return undefined;
		return { value, enumerable: true, configurable: true, writable: true };
	},
});
