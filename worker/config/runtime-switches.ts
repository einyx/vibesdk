// The runtime switches.
//
// The platform runs in two places: the Worker, and the builder on the host.
// The switches say which one answers. They are the operator's, not the
// user's, so they live in their own key rather than in the settings the
// console edits.
//
//   runtime_switches = { "builderBackend": "host" }
//
// A switch that is off is the default, so a platform with no switches at
// all behaves exactly as it did.

const SWITCHES_KEY = 'runtime_switches';

/** How long a switch is read for. A switch should not take long to flip. */
const SWITCH_TTL_MS = 5_000;

export type BuilderBackend = 'worker' | 'host';

export interface RuntimeSwitches {
	/** Where the builder's work happens. */
	builderBackend: BuilderBackend;
}

let cached: { switches: RuntimeSwitches; readAt: number } | null = null;

const DEFAULTS: RuntimeSwitches = { builderBackend: 'worker' };

/**
 * The switches, as they are now.
 *
 * A key that is not there, or that cannot be read, means the defaults: the
 * Worker answers.
 */
export async function getRuntimeSwitches(env: Env): Promise<RuntimeSwitches> {
	if (cached && Date.now() - cached.readAt < SWITCH_TTL_MS) {
		return cached.switches;
	}

	let switches = DEFAULTS;
	try {
		const stored = await env.VibecoderStore.get(SWITCHES_KEY);
		if (stored) {
			const parsed = JSON.parse(stored) as Partial<RuntimeSwitches>;
			switches = {
				builderBackend: parsed.builderBackend === 'host' ? 'host' : 'worker',
			};
		}
	} catch (error) {
		// A switch that cannot be read is a switch that is off.
		console.warn('[switches] could not be read', error);
		switches = DEFAULTS;
	}

	cached = { switches, readAt: Date.now() };
	return switches;
}

/** Forget the cached switches: the next read goes to the store. */
export function clearRuntimeSwitches(): void {
	cached = null;
}
