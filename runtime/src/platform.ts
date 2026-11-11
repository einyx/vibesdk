// The Cloudflare Workers module, for Node.
//
// The `agents` SDK and `partyserver` import `DurableObject`, `env`,
// `RpcTarget` and `exports` from "cloudflare:workers". This module is what
// that import resolves to when the SDK runs on Node: the same surface,
// backed by Node's own SQLite and by the session runtime's own sockets.
//
// It is a shim, not a reimplementation: the SDK above it is Cloudflare's and
// runs unmodified. What lives here is the platform the SDK expects to find
// underneath it.

import { RpcTarget } from './rpc.ts';
import { ambientEnv } from './env.ts';
import type { DurableObjectContext } from './types.ts';

/**
 * The base class the SDK's classes extend.
 *
 * A Durable Object is a stateful session: a context, an environment, and a
 * request handler. The subclasses own the behaviour; the platform owns the
 * storage, the sockets and the routing.
 */
export class DurableObject<Env = unknown> {
	readonly ctx: DurableObjectContext;
	readonly env: Env;

	constructor(ctx: DurableObjectContext, env: Env) {
		this.ctx = ctx;
		this.env = env;
	}

	/** The request handler. Subclasses override it. */
	fetch(_request: Request): Response | Promise<Response> {
		return new Response('Not implemented', { status: 501 });
	}

	/** A message arrived on one of this session's sockets. */
	webSocketMessage(_socket: unknown, _message: string | ArrayBuffer): void {}

	/** A socket closed. */
	webSocketClose(_socket: unknown, _code: number, _reason: string): void {}

	/** A socket failed. */
	webSocketError(_socket: unknown, _error: unknown): void {}

	/** The alarm fired. */
	alarm(): void | Promise<void> {}
}

/**
 * The ambient environment.
 *
 * The SDK reads `env.AI` and `env.EMAIL` off it. On Cloudflare that is the
 * binding table; here it is whatever the runtime was given.
 */
export const env = ambientEnv;

export { RpcTarget };

/**
 * The service export table.
 *
 * `ctx.exports.SomeClass` reaches a class bound in the same worker. In this
 * runtime there is one process, so the table is filled by the session
 * runtime when it starts.
 */
export const exports: Record<string, unknown> = {};

/**
 * The WebSocket pair.
 *
 * Cloudflare hands the runtime a pair of sockets when a request asks to
 * upgrade. Node's HTTP server hands us the socket instead, so the pair is
 * built from whatever the upgrade handler is holding: the session's end is
 * the socket we already have, and the client's end is the response's
 * business, not ours.
 */
let pendingSocket: unknown = null;

/** The socket the next upgrade belongs to. */
export function setPendingSocket(socket: unknown): void {
	pendingSocket = socket;
}

export class WebSocketPair {
	readonly 0: unknown;
	readonly 1: unknown;

	constructor() {
		const socket = pendingSocket;
		pendingSocket = null;
		this[0] = null;
		this[1] = socket;
	}
}

/**
 * WebSocket attachments.
 *
 * Cloudflare's WebSocket carries a serialized attachment, and the SDK reads
 * it off the prototype. Node's WebSocket has no such thing, so the native
 * class is extended with one: the attachment lives in a WeakMap, per
 * socket.
 */
export function patchWebSocket(): void {
	const NativeWebSocket = globalThis.WebSocket;
	const prototype = NativeWebSocket.prototype as unknown as { deserializeAttachment?: unknown };
	if (prototype.deserializeAttachment) return;

	const attachments = new WeakMap<object, unknown>();

	class PlatformWebSocket extends NativeWebSocket {
		serializeAttachment(attachment: unknown): void {
			attachments.set(this, attachment);
		}

		deserializeAttachment(): unknown {
			return attachments.get(this) ?? null;
		}
	}

	globalThis.WebSocket = PlatformWebSocket as unknown as typeof WebSocket;
}

/**
 * A response that carries a socket.
 *
 * `new Response(null, { status: 101, webSocket })` is Cloudflare's way of
 * saying "the connection was upgraded". Node's Response refuses a status
 * below 200 and drops the unknown init key, so the global Response is
 * widened once, here, and the socket is kept on the response for the
 * upgrade handler to pick up.
 */
export function responseWithSocket(body: BodyInit | null, init: ResponseInit & { webSocket?: unknown }): Response {
	const socket = init.webSocket;
	const response = new Response(body, init as ResponseInit);
	if (socket !== undefined) {
		Object.defineProperty(response, 'webSocket', { value: socket, enumerable: true });
	}
	return response;
}

let patched = false;

/** Widen the global Response so an upgraded connection can be described. */
export function patchResponse(): void {
	if (patched) return;
	patched = true;

	const NativeResponse = globalThis.Response;
	class PlatformResponse extends NativeResponse {
		constructor(body?: BodyInit | null, init?: ResponseInit & { webSocket?: unknown }) {
			if (init?.status === 101) {
				const { webSocket, ...rest } = init;
				super(body, { ...rest, status: 200 });
				Object.defineProperty(this, 'status', { value: 101, configurable: true });
				Object.defineProperty(this, 'webSocket', { value: webSocket, enumerable: true });
				return;
			}
			super(body, init);
		}
	}
	globalThis.Response = PlatformResponse as typeof Response;
}

/**
 * Apply the platform's changes to the globals the SDK expects.
 *
 * Called when the platform module is first evaluated, which is before the
 * SDK's own body runs — the SDK imports this module, so this module is
 * always evaluated first.
 */
export function applyPlatform(): void {
	patchResponse();
	patchWebSocket();
}

applyPlatform();
