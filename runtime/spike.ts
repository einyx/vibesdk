// The spike, run directly.
//
//   node runtime/spike.ts
//
// It loads Cloudflare's `agents` SDK through the platform's module hook and
// holds a session: state in SQLite, a message over a socket, and the state
// found again by a second runtime over the same directory.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { installHooks } = await import('./src/loader.ts');
installHooks();

const { Agent } = await import('agents');
const { SessionRuntime } = await import('./src/index.ts');

interface Connection {
	send(data: string): void;
}

class ProbeAgent extends (Agent as unknown as new (ctx: unknown, env: unknown) => {
	initialState: { count: number };
	state: { count: number };
	setState(state: { count: number }): void;
	onMessage(connection: Connection, message: string): Promise<void>;
}) {
	initialState = { count: 0 };

	async onMessage(connection: Connection, message: string): Promise<void> {
		this.setState({ count: this.state.count + 1 });
		connection.send(JSON.stringify({ count: this.state.count, message }));
	}
}

const dataDir = mkdtempSync(path.join(tmpdir(), 'vibesdk-spike-'));

const first = new SessionRuntime({ dataDir, env: {} });
const namespace = first.register(ProbeAgent as never);
const agent = namespace.getByName('app-one') as unknown as InstanceType<typeof ProbeAgent>;

console.log('state on a fresh session:', agent.state);
await agent.onMessage({ send: (data: string) => console.log('answer:', data) }, 'hello');
console.log('state after a message:', agent.state);
first.close();

const second = new SessionRuntime({ dataDir, env: {} });
const secondNamespace = second.register(ProbeAgent as never);
const again = secondNamespace.getByName('app-one') as unknown as InstanceType<typeof ProbeAgent>;
console.log('state after a restart:', again.state);
second.close();

rmSync(dataDir, { recursive: true, force: true });
