# The builder, off Cloudflare

The builder is a Cloudflare Worker with Durable Objects, D1, R2, KV, Workers
AI, Browser Rendering and Artifacts. This is what it would take to run it in
the cluster instead, and in what order.

The target is not "the same code on another runtime". It is the same product,
with the Cloudflare-only pieces replaced by things the cluster already runs:
Postgres for D1, the node's disk for R2, Forgejo for Artifacts, the
`runner` and `publisher` services for previews and deploys, a Chromium
sidecar for Browser Rendering, and Logto — already self-hosted — for auth.

## What the builder is today

An inventory of the Cloudflare surface, by how hard it is to move.

| Piece | Cloudflare feature | Difficulty |
| --- | --- | --- |
| `CodeGeneratorAgent` | DO, `agents` SDK, hibernatable WebSockets, DO SQLite (`cf_agents_state`), git over `SqliteFS` | **Highest** |
| `ThinkAgent` | DO, `@cloudflare/think`, DO SQLite | **Highest** |
| `SpaceDO` | DO, DO SQLite, `ctx.facets`, `ctx.exports`, `ctx.abort` | **High** |
| `UserSecretsStore` | DO, DO SQLite, hibernatable WebSockets, alarms | Medium |
| `DORateLimitStore` | DO with KV-backed storage | Low |
| D1 | 23 tables, Drizzle on SQLite, two raw `prepare()` calls | Low |
| KV | one namespace, five key patterns (config, cache, rate limits, wrangler config) | Low |
| R2 | one bucket: screenshots, uploads, the template catalog | Low |
| AI | mostly OpenAI-compatible already; `env.AI.gateway()` and `env.AI.run()` are the Cloudflare-only parts | Medium |
| Browser Rendering | `@cloudflare/puppeteer`; the dev sidecar already replicates it exactly | Low |
| Artifacts | the git remote for every app's history | Medium |
| Worker Loader | the preview host for generated apps | **Solved** — the `runner` serves previews now |
| Ambient `import { env }` | nine files | Low |
| `HTMLRewriter`, `caches.default`, `CF-Connecting-IP` | three isolated usages | Low |

Two facts make the plan smaller than it looks. The `runner` and `publisher`
already replaced the two most expensive Cloudflare features — the container
runtime and the Worker Loader — so the preview path no longer needs a paid
plan. And `scripts/dev-browser-sidecar.ts` is already a 1:1 replacement for
Browser Rendering, sharing `capture-core.ts` with the production path.

What remains hard is the **session runtime**: three Durable Objects that
hold the agent's conversation, its workspace and its git history, and that
own the WebSocket the chat runs over.

## The target

```
browser ── apps.prysm.sh ── edge Caddy
                                ├── builder service   (Node/Bun + Hono, the same routes)
                                │     ├── sessions   (agent state, WebSocket routing)
                                │     ├── spaces     (workspace + git, one volume per app)
                                │     └── api        (77 routes, unchanged contract)
                                ├── Postgres         (D1, KV, rate limits, session registry)
                                ├── Forgejo          (the git remote for every app's history)
                                ├── runner           (previews)      ← already in the cluster
                                ├── publisher        (deploys)       ← already in the cluster
                                └── browser sidecar  (screenshots)
```

The wire contract does not change: the frontend and the SDK keep talking to
the same 77 routes and the same 61 WebSocket message types. The SDK re-exports
the worker's protocol types directly, so the types stay where they are.

## The session runtime

This is the part that decides whether the port is a project or an impossibility.

A Durable Object here is three things at once: a stateful session with
SQLite storage, a WebSocket endpoint that can hibernate, and an RPC target
other code calls into (`env.SPACE_DO.get(idFromName(name))`,
`getAgentByName(env.CodeGenObject, agentId)`).

Off-platform, that becomes:

- **Session state** — a SQLite file per session, on a volume.
- **Session routing** — a registry mapping an app id to the session that
  holds it, so `GET /api/agent/:id/ws` reaches the right session and
  `env.SPACE_DO.get(idFromName(name))` reaches the right workspace.
- **WebSockets** — a plain socket server per process. Hibernation is not
  needed: a hibernating DO costs nothing while idle, and a Node process
  holding a session costs memory. The counter-pressure is the opposite of
  Cloudflare's: here an idle session is *expensive*, so sessions need to be
  parked (state written, connection dropped, rehydrated on the next request)
  or the process must be elastic.

### What the spike proved

The question this section used to hold open was whether the `agents` SDK
could run off Durable Objects at all. It can, and nothing had to be
rewritten: `runtime/` provides the platform the SDK expects, and the SDK —
Cloudflare's own — runs on it.

```
state on a fresh session: { count: 0 }
answer: {"count":1,"message":"hello"}
state after a message: { count: 1 }
state after a restart: { count: 1 }
```

The surface the SDK reaches for is eight methods and a table: `ctx.id.name`,
`ctx.storage.sql.exec`, the key-value store, the alarms, the sockets, the
lifecycle calls, the export table, and the ambient environment. Everything
above that — the agent's state, its tools, its compaction — is ordinary
TypeScript and moves untouched.

What that changes about the plan: Phase 3 is not "port the agent runtime".
It is "port the agent runtime's surroundings" — the workspace, the
cross-session calls, the parking policy — and then run the SDK that is
already here.

## Phases

Each phase is shippable on its own, and each one moves the product
closer to the cluster without breaking it.

**Phase 0 — the seam.** Make the runtime explicit. The nine files with
ambient `import { env }` become `import { config }`, and the platform
bindings (`env.DB`, `env.VibecoderStore`, `env.TEMPLATES_BUCKET`, `env.AI`,
`env.BROWSER`, `env.ARTIFACTS`, `env.LOADER`) become an injected interface
with a Cloudflare implementation and a Node implementation. Nothing changes
about behaviour; the code stops assuming it runs on Workers.

**Phase 1 — storage.** D1 to Postgres (Drizzle's Postgres driver; the schema
is plain SQL, but `blob` columns and `withSession()` need a decision),
KV to Postgres or Redis, R2 to the node's disk or MinIO. The screenshot
fallback that already exists (screenshots in D1 when no bucket is bound)
becomes the real path rather than the exception.

**Phase 2 — the space.** The workspace and its history. Today: `@cloudflare/shell`'s
`Workspace` over DO SQLite, with Artifacts as the git remote. Off-platform:
a real directory per app on a volume, real git, and Forgejo as the remote
(Forgejo already runs on the prysm host). The `SpaceFsBackend` interface is
the seam — a third backend drops in beside the two that exist. The
filesystem and the workspace are written (`runtime/src/workspace/`): the
seventeen methods of `FileSystem` over Node's own, and the git that
`@cloudflare/shell` already speaks, which is isomorphic-git and portable.

**Phase 3 — the session runtime.** The platform is written (`runtime/`) and
the SDK runs on it. What is left is the surroundings: the HTTP layer that
routes a request to the session that owns the name, the workspace inside a
session, the cross-session calls, and the parking policy for idle sessions.
Then `CodeGeneratorAgent` and `ThinkAgent` run on it.

**Phase 4 — the edge.** The SPA served by Caddy instead of `env.ASSETS`,
the WebSocket endpoint routed by the session registry, the preview and
deploy paths pointed at the `runner` and the `publisher` (already done).

**Phase 5 — cut over.** The builder runs in the cluster; the Worker stays as
a thin read-only front for the app catalogue and the public pages until the
data is moved across.

## The risks

- **The workspace.** The agent's files and its git history live inside the
  session (a Durable Object with `@cloudflare/shell`'s `Workspace` over DO
  SQLite), with Cloudflare Artifacts as the remote. Off-platform that is a
  directory on a volume and a real git — but the SDK's own `FileSystem`
  interface is the seam, and the workspace is where the generated app is
  hosted as a facet.
- **The generated app's runtime is still workerd.** Moving the builder off
  Cloudflare does not move the apps it generates — they run in the
  publisher's pods, on workerd, which is the open-source runtime. That is
  already the case.
- **Idle sessions cost memory.** The opposite of Cloudflare's economics.
  Needs a parking policy before the first real user, not after.
- **One node.** The cluster is a single k3s node today. The builder moving
  there moves its availability there with it, and the builder is the
  product.
- **The API is not small.** 77 routes and 61 WebSocket message types, and
  the SDK re-exports the worker's protocol types, so the frontend and the
  SDK must keep working against the same contract throughout.

## What is already done

- **The platform** (`runtime/`): the Durable Object surface the `agents` SDK
  expects, on Node, with the SDK running on it unmodified. Its state is
  SQLite, on a volume; a session survives the process.
- **The preview host**: the `runner` serves previews on the cluster, so the
  Worker Loader and DO Facets — the paid-plan features — are no longer
  needed.
- **The deploy host**: the `publisher` applies an app's stack to the
  cluster, so the Worker is no longer the deploy target either.
- **Browser Rendering**: the sidecar replaces the binding, exactly.

## The shape

The builder is a service on the cluster, not a program on a host. The
Worker stays the front door — it owns the hostname, the certificates and
the edge — and a switch says where the work happens.

```
browser ── apps.prysm.sh ── edge ── Worker ──┬─ (off) the Worker answers
                                               └─ (on)  the pod answers
```

Inside the cluster there are two kinds of pod:

- **The control plane** — the API, the catalogue, the sign-in. One
  deployment, a shared database, no app's volume.
- **A session's pod** — the agent for one app, with that app's volume
  mounted. A pod can only mount the volumes it declares, and a volume per
  app means the session that owns the app has a pod of its own.

The front door has to know which pod an app's session runs in, so a router
in the cluster resolves the app id to the pod's address and forwards; the
Worker sends the session's routes to it.

## The switch

The switch is `runtime_switches` in the key-value store:

```json
{ "builderBackend": "host" }
```

It is read for five seconds, so a flip takes effect without a deploy, and
it is off when it is not there — a platform with no switches behaves
exactly as it did. The host's address is `BUILDER_SERVICE_URL`; without it
the switch has nowhere to send anything, and says so.

The Worker's middleware forwards the request whole: the cookies, the
authorization and the upgrade headers travel, because the host does the
same work the Worker would have done — the same routes, the same
authentication, the same chat.

## Open decisions

1. **Where does an app's workspace live** — **a volume per app.** Decided.
   Each app gets its own volume, mounted by the session that owns it, so
   the workspace is local to the session that writes it, and an app's files
   and history are backed up, moved and deleted as one thing. The cost is
   that a builder process cannot hold every app's volume at once, which
   settles decision 4 below: a session runs in a pod of its own, mounting
   that app's volume.
2. **The git remote** — Forgejo (it runs, it is a real forge, the API differs
   from Artifacts) or bare git repositories on a volume (no API to speak of,
   nothing to run).
3. **Where the platform's data goes** — one Postgres for everything (simple,
   one backup story, hot rows) or Postgres for the catalogue and SQLite per
   session for the agent state (which is what the SDK already writes).
4. **How the HTTP layer is shaped** — one process that holds every session
   (simple, one port, a session per app in memory) or one process per
   session (isolated, elastic, and the only shape a volume per app
   allows).
