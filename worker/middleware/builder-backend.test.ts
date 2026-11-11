import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { builderBackend } from './builder-backend';
import { clearRuntimeSwitches } from '../config/runtime-switches';

/**
 * The switch between the two builders.
 *
 * The Worker stays the front door; the switch says whether the work
 * happens here or on the host. Off is the default, and off means nothing
 * changes.
 */

function envWith(switches: unknown | null, serviceUrl?: string): Env {
	const store = new Map<string, string>();
	if (switches !== null) store.set('runtime_switches', JSON.stringify(switches));
	return {
		VibecoderStore: {
			get: async (key: string) => store.get(key) ?? null,
		},
		BUILDER_SERVICE_URL: serviceUrl,
	} as unknown as Env;
}

function app(env: Env): Hono {
	const instance = new Hono();
	instance.use('/api/*', builderBackend);
	instance.get('/api/health', (c) => c.json({ answeredBy: 'worker' }));
	return instance;
}

/** A request, with the environment the middleware reads. */
function request(env: Env, path: string): Promise<Response> {
	return app(env).request(path, {}, env);
}

describe('the builder backend', () => {
	it('answers itself when the switch is off', async () => {
		clearRuntimeSwitches();
		const response = await request(envWith(null), '/api/health');
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ answeredBy: 'worker' });
	});

	it('answers itself when the switch says worker', async () => {
		clearRuntimeSwitches();
		const response = await request(envWith({ builderBackend: 'worker' }), '/api/health');
		expect(await response.json()).toEqual({ answeredBy: 'worker' });
	});

	it('sends the work to the host when the switch says host', async () => {
		clearRuntimeSwitches();
		const forwarded: string[] = [];
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			forwarded.push(String(input));
			return new Response(JSON.stringify({ answeredBy: 'host' }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		});

		try {
			const response = await request(
				envWith({ builderBackend: 'host' }, 'https://builder.prysm.sh'),
				'/api/health?x=1',
			);

			expect(await response.json()).toEqual({ answeredBy: 'host' });
			expect(forwarded[0]).toBe('https://builder.prysm.sh/api/health?x=1');
		} finally {
			fetchSpy.mockRestore();
		}
	});

	it('says so when the host is not configured', async () => {
		clearRuntimeSwitches();
		const response = await request(envWith({ builderBackend: 'host' }), '/api/health');
		expect(response.status).toBe(503);
		expect((await response.json()).error.type).toBe('unavailable');
	});
});
