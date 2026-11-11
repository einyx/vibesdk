// The Workers module, as the host sees it.
//
// The `runtime` package is the Workers runtime for Node: the Durable Object
// surface, the ambient environment, the sockets. This module is that
// platform plus the two Workers exports it does not have yet — the service
// base class and the tracing helper — so the SDKs that import them load.
//
// Everything here is a stub that says what is missing when it is used. The
// host does not run containers and it does not trace spans; the builder's
// previews are served by the runner, not by Cloudflare Containers.

export {
	DurableObject,
	env,
	exports,
	WebSocketPair,
	applyPlatform,
	patchResponse,
	patchWebSocket,
	responseWithSocket,
	setPendingSocket,
} from '../../../runtime/src/platform.ts';
export { RpcTarget } from '../../../runtime/src/rpc.ts';

/**
 * A service: a class bound to a Worker, with a context and an environment.
 *
 * The host has no services — the publisher and the runner are their own
 * programs — so this is the Durable Object's shape without the storage.
 */
export class WorkerEntrypoint<Env = unknown> {
	readonly ctx: unknown;
	readonly env: Env;

	constructor(ctx: unknown, env: Env) {
		this.ctx = ctx;
		this.env = env;
	}

	/** The request handler. Subclasses override it. */
	fetch(_request: Request): Response | Promise<Response> {
		return new Response('Not implemented', { status: 501 });
	}
}

/**
 * Tracing.
 *
 * The host does not trace spans. The helper exists so that the code that
 * asks for one loads and keeps going.
 */
export const tracing = {
	enterSpan: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
};
