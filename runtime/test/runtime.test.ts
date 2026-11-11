import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// The Cloudflare `agents` SDK, loaded through the platform. The alias in
// vitest.runtime.config.ts stands in for the module hook the loader
// installs outside a test.
const { Agent } = await import('agents');
const { SessionRuntime } = await import('../src/index.ts');

interface Connection {
	send(data: string): void;
}

class ProbeAgent extends (Agent as unknown as new (ctx: unknown, env: unknown) => {
	initialState: { count: number; messages: string[] };
	state: { count: number; messages: string[] };
	setState(state: { count: number; messages: string[] }): void;
	onMessage(connection: Connection, message: string): Promise<void>;
}) {
	initialState = { count: 0, messages: [] };

	async onMessage(connection: Connection, message: string): Promise<void> {
		const state = { count: this.state.count + 1, messages: [...this.state.messages, message] };
		this.setState(state);
		connection.send(JSON.stringify({ type: 'echo', count: state.count, message }));
	}
}

function dataDir(): string {
	return mkdtempSync(path.join(tmpdir(), 'vibesdk-runtime-'));
}

function runtime(dir: string): InstanceType<typeof SessionRuntime> {
	return new SessionRuntime({ dataDir: dir, env: {} });
}

describe('the agents SDK on Node', () => {
	it('holds a session and keeps its state', async () => {
		const dir = dataDir();
		const sessions = runtime(dir);
		const namespace = sessions.register(ProbeAgent as never);

		const agent = namespace.getByName('app-one') as unknown as ProbeAgent;
		expect(agent.state).toEqual({ count: 0, messages: [] });

		const answers: string[] = [];
		await agent.onMessage({ send: (data: string) => answers.push(data) }, 'hello');
		expect(agent.state.count).toBe(1);
		expect(JSON.parse(answers[0])).toEqual({ type: 'echo', count: 1, message: 'hello' });

		sessions.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it('finds the state again after the runtime restarts', async () => {
		const dir = dataDir();

		const first = runtime(dir);
		const firstAgent = first.register(ProbeAgent as never).getByName('app-one') as unknown as ProbeAgent;
		await firstAgent.onMessage({ send: () => undefined }, 'remembered');
		first.close();

		// A new runtime over the same directory: the state is on disk.
		const second = runtime(dir);
		const secondAgent = second.register(ProbeAgent as never).getByName('app-one') as unknown as ProbeAgent;
		expect(secondAgent.state.count).toBe(1);
		expect(secondAgent.state.messages).toEqual(['remembered']);
		second.close();

		rmSync(dir, { recursive: true, force: true });
	});

	it('keeps one session apart from another', async () => {
		const dir = dataDir();
		const sessions = runtime(dir);
		const namespace = sessions.register(ProbeAgent as never);

		const one = namespace.getByName('app-one') as unknown as ProbeAgent;
		const two = namespace.getByName('app-two') as unknown as ProbeAgent;
		await one.onMessage({ send: () => undefined }, 'one');

		expect(one.state.count).toBe(1);
		expect(two.state.count).toBe(0);
		sessions.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it('reaches a session through its stub', async () => {
		const dir = dataDir();
		const sessions = runtime(dir);
		const namespace = sessions.register(ProbeAgent as never);

		// The way the app reaches another session: a stub, by name.
		const stub = namespace.getByName('app-one') as unknown as {
			onMessage(connection: Connection, message: string): Promise<void>;
			state: { count: number };
		};
		await stub.onMessage({ send: () => undefined }, 'through the stub');

		expect(stub.state.count).toBe(1);
		sessions.close();
		rmSync(dir, { recursive: true, force: true });
	});
});
