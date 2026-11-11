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

- **Session state** — Postgres rows per app (or SQLite per app on its volume).
  The `agents` SDK keeps the whole agent state in one row of one table
  (`cf_agents_state`); a port can keep that shape and the same serialisation.
- **Session routing** — a registry mapping an app id to the process holding
  its session, so `GET /api/agent/:id/ws` reaches the right session and
  `env.SPACE_DO.get(idFromName(name))` reaches the right workspace. Redis or
  Postgres, with the process re-announcing itself on start.
- **WebSockets** — a plain `ws` server per process. Hibernation is not
  needed: a hibernating DO costs nothing while idle, and a Node process
  holding a session costs memory. The counter-pressure is the opposite of
  Cloudflare's: here an idle session is *expensive*, so sessions need to be
  parked (state written, connection dropped, rehydrated on the next request)
  or the process must be elastic.

The `agents` and `partyserver` packages are Cloudflare's, and they are where
the state, the hibernation and the RPC live. The application's own agent
logic — `worker/agents/**`, roughly 6,000 lines — is ordinary TypeScript and
moves. So the port is not "rewrite the agent"; it is "reimplement the DO
binding layer the SDK provides, and keep everything above it".

That reimplementation is the spike. Until it is written, the plan is a
hypothesis.

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
the seam — a third backend drops in beside the two that exist.

**Phase 3 — the session runtime.** The spike from the section above, then
`CodeGeneratorAgent` and `ThinkAgent` on it.

**Phase 4 — the edge.** The SPA served by Caddy instead of `env.ASSETS`,
the WebSocket endpoint routed by the session registry, the preview and
deploy paths pointed at the `runner` and the `publisher` (already done).

**Phase 5 — cut over.** The builder runs in the cluster; the Worker stays as
a thin read-only front for the app catalogue and the public pages until the
data is moved across.

## The risks

- **The `agents` SDK.** If its DO-free core is not cleanly separable, Phase 3
  becomes "port the agent framework" rather than "port the agent". This is
  the risk worth spending the spike on first.
- **The workspace's git history.** Artifacts gives every app a repo with
  branches and restore points, and the UI has a Repo tab that reads it. Forgejo
  can do this, but the API is not the same and the `packages/artifacts-viewer`
  frontend talks to Artifacts directly.
- **Idle sessions cost memory.** The opposite of Cloudflare's economics. Needs
  a parking policy before the first real user, not after.
- **One node.** The cluster is a single k3s node today. The builder moving
  there moves its availability there with it, and the builder is the product.
- **The generated app's runtime is still workerd.** Moving the builder off
  Cloudflare does not move the apps it generates — they run in the publisher's
  pods, on workerd, which is the open-source runtime. That is already the
  case.

## Open decisions

1. **Where does an app's workspace live** — a volume per app, or one shared
   volume with a directory per app? The first is simpler to reason about and
   to back up; the second wastes less space on an idle app.
2. **The git remote** — Forgejo (it runs, it is a real forge, the API differs
   from Artifacts) or bare git repositories on a volume (no API to speak of,
   nothing to run).
3. **Postgres or SQLite per session** — one database for everything (simple,
   one backup story, hot rows) or a database per app (isolation, closer to
   the DO model, more to operate).
4. **How the `agents` SDK is replaced** — reimplement its DO-free core in this
   repository, or vendor the SDK and patch it. The first is ours to maintain;
   the second is upstream's code with our patches.
