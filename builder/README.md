# The builder, on the host

The same application the Worker runs, on Node. The routes, the contracts and
the code are the Worker's; what changes is where the platform's pieces come
from:

| On Workers | On the host |
| --- | --- |
| D1 | a SQLite file (`builder/src/storage/d1.ts`) |
| KV | a table in the same file (`builder/src/storage/kv.ts`) |
| Workers Assets | a directory (`builder/src/storage/assets.ts`) |
| Durable Objects | the session runtime (`runtime/`) |
| `cloudflare:workers` | `runtime/src/platform.ts`, resolved by a runtime hook |
| Workers AI | direct providers, with their own keys |

Both runtimes share the source. The Worker is unchanged and still deploys;
this is the other end of the same application.

## Build

```sh
bun run build:builder      # builder/dist
```

The bundle keeps the dependencies external — they are Node's to load — and
resolves the Workers modules at runtime, through `builder/hooks.mjs`, so the
SDK and the application share one platform instance.

## Run

```sh
# The database, once: the same migrations the Worker applies.
DATABASE_PATH=/data/builder.sqlite MIGRATIONS_DIR=migrations \
  bun run --cwd builder migrate

# The service.
DATABASE_PATH=/data/builder.sqlite DATA_DIR=/data PORT=8080 \
  JWT_SECRET=... LOGTO_ISSUER=... LOGTO_CLIENT_ID=... LOGTO_CLIENT_SECRET=... \
  bun run --cwd builder start
```

The configuration is the Worker's own variables, read from the environment.
The service starts without the ones it does not need yet and says which they
are; the paths that need them fail where they are used.

## Test

```sh
bun run test:builder
```

The suite covers the storage adapters, the migrations, and the service
itself: it boots, answers the health check, lists the sign-in providers,
refuses a request without a session, and answers an authenticated request
with data from its own database.

## What is not here yet

- **The workspaces.** `SpaceDO` is a Workers Durable Object; the workspace
  and the git history it holds have no home on the host yet. The filesystem
  and the workspace are written (`runtime/src/workspace/`): the same
  `FileSystem` the git is written against, over a volume.
- **Postgres.** The database is SQLite, the same dialect D1 speaks, so the
  queries are the Worker's own. The plan calls for Postgres on the host; the
  schema change is a separate step.
