# The runtime — the builder's sessions, on Node

The Cloudflare `agents` SDK is a Durable Object framework: a session with
its own SQLite, its own WebSockets, and an address other code reaches it
by. This package provides the same surface on Node, so the SDK — and the
agent code above it — run unchanged.

The point is not to reimplement the SDK. It is to give it the platform it
expects to find underneath it.

```
installHooks();                       // "cloudflare:workers" resolves here
const { Agent } = await import('agents');

const runtime = new SessionRuntime({ dataDir: '/data/sessions', env: {} });
const namespace = runtime.register(Agent);
const stub = namespace.getByName('my-app');   // the session, by name
```

## What the platform provides

The SDK reaches for a narrow slice of the Durable Object runtime. This is
all of it:

| The SDK uses | Here |
| --- | --- |
| `ctx.id.name` | the session's name |
| `ctx.storage.sql.exec(query, …)` | SQLite, on a volume (`node:sqlite`) |
| `ctx.storage.get/put/delete/list` | a table in the same file |
| `ctx.storage.setAlarm/getAlarm/deleteAlarm` | a table in the same file |
| `ctx.acceptWebSocket` / `ctx.getWebSockets` | the session's sockets |
| `ctx.waitUntil` / `ctx.blockConcurrencyWhile` / `ctx.abort` | the lifecycle |
| `ctx.exports` / `ctx.facets` | the session registry |
| `env.AI`, `env.EMAIL`, … | the ambient environment |
| `RpcTarget`, `exports` | the RPC marker and the export table |
| `WebSocketPair` | the socket the upgrade handler is holding |
| `Response({ status: 101, webSocket })` | a widened global `Response` |
| `WebSocket.prototype.serializeAttachment` | a widened global `WebSocket` |

Nothing else in the SDK is Cloudflare-specific, and the agent code above it
— `worker/agents/**` — is ordinary TypeScript.

## What the spike proved

`runtime/spike.ts` loads the real SDK and holds a session:

```sh
node runtime/spike.ts
```

```
state on a fresh session: { count: 0 }
answer: {"count":1,"message":"hello"}
state after a message: { count: 1 }
state after a restart: { count: 1 }
```

The last line is the one that matters: the state is in SQLite, on disk, and
a second runtime over the same directory finds it. The session survives the
process.

## The two rules

The runtime is loaded by Node's type stripping, which is stricter than
TypeScript:

- **no parameter properties** — `constructor(private readonly x: string)` is
  not erasable; write the field and assign it.
- **no `readonly` in front of a method signature** — `readonly toString():
  string` inside a type literal is not erasable either.

Both are in the runner and the publisher for the same reason.

## What is not here yet

- **The cross-session calls** the SDK makes through `ctx.exports` and
  `ctx.facets`: the workspace that lives inside a session, and the app that
  is generated inside it.
- **Hibernation.** On Cloudflare an idle session costs nothing; here it
  costs memory. Sessions need a parking policy, and the SDK's hibernating
  connection manager is the wrong shape for it.
- **The HTTP layer.** The runtime holds sessions; something has to route a
  request to the session that owns the name, and hand it the socket.
