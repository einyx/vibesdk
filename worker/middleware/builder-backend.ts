// The builder's backend.
//
// The platform's work happens in one of two places: the Worker, or the
// builder on the host. The switch says which. When the host is answering,
// the Worker is the front door and the work goes through it.
//
// The front door stays the Worker for a reason: it owns the hostname, the
// certificates and the edge. What moves behind it is the work — the API,
// and the chat's socket.

import type { MiddlewareHandler } from 'hono';
import { getRuntimeSwitches } from '../config/runtime-switches';
import type { AppEnv } from '../types/appenv';

/** The host builder's address, when there is one. */
function builderServiceUrl(env: Env): string | null {
	const configured = (env as unknown as { BUILDER_SERVICE_URL?: string }).BUILDER_SERVICE_URL?.trim();
	if (!configured) return null;
	return configured.replace(/\/$/, '');
}

/**
 * Send the request to the builder on the host.
 *
 * The request goes as it is: the cookies, the authorization and the
 * upgrade headers all travel, because the host does the same work the
 * Worker would have done — the same routes, the same authentication, the
 * same chat.
 */
async function forward(request: Request, env: Env): Promise<Response> {
	const base = builderServiceUrl(env);
	if (!base) {
		return new Response(
			JSON.stringify({ error: { message: 'The host builder is not configured', type: 'unavailable' } }),
			{ status: 503, headers: { 'Content-Type': 'application/json' } },
		);
	}

	const url = new URL(request.url);
	const target = new URL(`${url.pathname}${url.search}`, base);

	try {
		const response = await fetch(target.toString(), request);
		// Which backend answered is worth being able to see.
		if (response.status === 101) return response;
		const headers = new Headers(response.headers);
		headers.set('x-builder-backend', 'host');
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	} catch (error) {
		console.error('[builder-backend] the host builder could not be reached', error);
		return new Response(
			JSON.stringify({ error: { message: 'The host builder could not be reached', type: 'unavailable' } }),
			{ status: 502, headers: { 'Content-Type': 'application/json' } },
		);
	}
}

/**
 * The middleware.
 *
 * When the switch is off — the default — the request goes on to the
 * Worker, and nothing changes.
 */
export const builderBackend: MiddlewareHandler<AppEnv> = async (c, next) => {
	const switches = await getRuntimeSwitches(c.env);
	if (switches.builderBackend !== 'host') {
		return next();
	}
	return forward(c.req.raw, c.env);
};
