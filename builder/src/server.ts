// The HTTP server.
//
// The application is a fetch handler: a Request in, a Response out. Node's
// HTTP server is not, so the two are bridged here — and the routing follows
// the Worker's: the API and the OAuth paths go to the application, and
// everything else is the single-page application.
//
// The preview and the deployed-app paths are not here: on the host the
// runner serves the previews and the publisher serves the deployed apps, on
// their own hostnames.

import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';

import type { Assets } from './storage/assets.ts';
import { setPendingSocket } from '../../runtime/src/platform.ts';
import type { SessionRuntime } from '../../runtime/src/session.ts';

export interface ServerOptions {
	/** The application. */
	fetch: (request: Request, env: Env, ctx: ExecutionContext) => Response | Promise<Response>;
	env: Env;
	assets: Assets;
	/** The origin the server answers on, used to build absolute URLs. */
	origin: string;
	/** The sessions, for the sockets the chat runs over. */
	sessions?: SessionRuntime;
}

/** The context the application expects: a place to leave background work. */
const executionContext = (): ExecutionContext =>
	({
		waitUntil: (promise: Promise<unknown>) => {
			void promise.catch(() => undefined);
		},
		passThroughOnException: () => undefined,
	}) as unknown as ExecutionContext;

const requestHeaders = (request: IncomingMessage): Headers => {
	const headers = new Headers();
	for (const [name, value] of Object.entries(request.headers)) {
		if (value === undefined) continue;
		if (Array.isArray(value)) {
			for (const item of value) headers.append(name, item);
			continue;
		}
		headers.set(name, value);
	}
	return headers;
};

/** A Node request, as the fetch handler wants it. */
const toRequest = (request: IncomingMessage, origin: string): Request => {
	const url = new URL(request.url ?? '/', origin);
	const method = request.method ?? 'GET';
	const hasBody = method !== 'GET' && method !== 'HEAD';

	return new Request(url, {
		method,
		headers: requestHeaders(request),
		body: hasBody ? (Readable.toWeb(request) as unknown as BodyInit) : undefined,
		// Node's fetch wants to know the body may be a stream.
		...(hasBody ? { duplex: 'half' } : {}),
	} as RequestInit);
};

/** A fetch response, back to Node. */
const writeResponse = async (response: ServerResponse, result: Response): Promise<void> => {
	const headers: Record<string, string | string[]> = {};
	result.headers.forEach((value, name) => {
		if (name === 'set-cookie') {
			const existing = headers[name];
			headers[name] = Array.isArray(existing) ? [...existing, value] : existing ? [existing, value] : [value];
			return;
		}
		headers[name] = value;
	});

	response.writeHead(result.status, headers);
	if (!result.body) {
		response.end();
		return;
	}

	await new Promise<void>((resolve, reject) => {
		Readable.fromWeb(result.body as never)
			.on('error', reject)
			.on('end', resolve)
			.pipe(response);
	});
};

/** The paths the application answers, rather than the assets. */
const isApplicationPath = (pathname: string): boolean =>
	pathname.startsWith('/api/') ||
	pathname.startsWith('/oauth/') ||
	pathname === '/auth/callback' ||
	pathname.startsWith('/auth/');

/** The server. */
export function createServer(options: ServerOptions): http.Server {
	const server = http.createServer((request, response) => {
		void (async () => {
			try {
				const incoming = toRequest(request, options.origin);
				const url = new URL(incoming.url);

				const result = isApplicationPath(url.pathname)
					? await options.fetch(incoming, options.env, executionContext())
					: await options.assets.fetch(incoming);

				await writeResponse(response, result);
			} catch (error) {
				console.error('[builder] request failed', error);
				if (!response.headersSent) {
					response.writeHead(500, { 'content-type': 'application/json' });
				}
				response.end(JSON.stringify({ error: 'internal_error' }));
			}
		})();
	});

	/**
	 * The chat's socket.
	 *
	 * An upgrade is a request the application routes like any other: the
	 * controller hands it to the session, and the session's runtime builds
	 * its connection from the socket the upgrade handler is holding. What
	 * comes back is a response with a socket on it, and the socket is
	 * already the client's — Node's upgrade has happened by now.
	 */
	const sockets = new WebSocketServer({ noServer: true });
	sockets.on('connection', (socket: WebSocket, request: IncomingMessage) => {
		void (async () => {
			try {
				const incoming = toRequest(request, options.origin);
				// The session the socket belongs to is bound by the runtime,
				// when the application hands the request to the session.
				await options.fetch(incoming, options.env, executionContext());

				socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
					void options.sessions?.webSocketMessage(socket, toMessage(data));
				});
				socket.on('close', (code: number, reason: Buffer) => {
					void options.sessions?.webSocketClose(socket, code, reason.toString());
				});
			} catch (error) {
				console.error('[builder] the socket failed', error);
				socket.close(1011, 'the connection could not be established');
			}
		})();
	});

	server.on('upgrade', (request, socket, head) => {
		sockets.handleUpgrade(request, socket, head, (websocket) => {
			// The SDK's WebSocketPair takes the socket from here.
			setPendingSocket(websocket);
			sockets.emit('connection', websocket, request);
		});
	});

	return server;
}

/** A socket's message, as the session expects it. */
function toMessage(data: Buffer | ArrayBuffer | Buffer[]): string | ArrayBuffer {
	if (typeof data === 'string') return data;
	if (data instanceof ArrayBuffer) return data;
	const buffer = Buffer.isBuffer(data) ? data : Buffer.concat(data);
	return buffer.toString('utf8');
}
