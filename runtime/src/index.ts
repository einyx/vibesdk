// The Node platform for the builder's sessions.
//
// The Cloudflare `agents` SDK is a Durable Object framework: a session with
// its own SQLite, its own WebSockets, and an address other code reaches it
// by. This package provides the same surface on Node, so the SDK — and the
// agent code above it — run unchanged.
//
//   import { register } from 'node:module';
//   register('./loader.ts', import.meta.url);
//
//   const { Agent } = await import('agents');
//
//   const runtime = new SessionRuntime({ dataDir: '/data/sessions', env: {} });
//   const namespace = runtime.register(Agent);
//   const stub = namespace.getByName('my-app');
//
// The pieces:
//
//   platform.ts   the "cloudflare:workers" module: DurableObject, env, RpcTarget
//   storage.ts    a session's SQLite and key-value store
//   context.ts    a session's context: name, storage, sockets, lifecycle
//   session.ts    the runtime: sessions, namespaces, routing
//
// What is not here yet: the cross-session calls the SDK makes through
// `ctx.exports` and `ctx.facets` (the workspace and the generated app
// that live inside a session), and the hibernation the SDK does when a
// session is idle.

export { SessionRuntime } from './session.ts';
export type { SessionNamespace, SessionStub, SessionInstance, SessionConstructor } from './session.ts';
export { NodeContext } from './context.ts';
export { SqliteStorage } from './storage.ts';
export { setAmbientEnv } from './env.ts';
export { setPendingSocket, patchResponse, patchWebSocket } from './platform.ts';
export { RpcTarget } from './rpc.ts';
