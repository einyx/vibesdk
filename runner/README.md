# The Runner

The sandbox behind the builder. The worker asks it for a preview; the
runner starts the app's own dev server and serves it under one address.

It exists because the in-process path — loading the generated app into a
Durable Object Facet through the Worker Loader — needs Workers Paid. The
runner needs nothing but node and a disk.

## What it is

One process, two faces:

```
POST /instances            create an instance from a set of files
GET  /instances             list them
GET  /instances/:id         one of them
GET  /instances/:id/status  is it up, and where does it live
POST /instances/:id/files   write files into it
GET  /instances/:id/files   read them back
POST /instances/:id/commands  run a command in it
GET  /instances/:id/errors  the errors its dev server reported
GET  /instances/:id/logs    its stdout and stderr
GET  /instances/:id/analysis  typecheck it
POST /instances/:id/deploy  the runner *is* the deployment target
DELETE /instances/:id       shut it down
```

and, beside the API, the preview proxy:

```
GET /p/<instance>/…         the app, served by its own dev server
```

The API is bearer-token gated. The preview proxy is not: it is the app,
and it is addressed publicly.

## The contract

`protocol.ts` is the API — the schemas the worker validates every
response against, and the types the runner's own answers are checked
against. It lives here, with the service that answers it, so the two
halves cannot drift apart.

## Running it

```
API_KEY=... DATA_DIR=... RUNNER_HOST=... npm start
```

| Variable | What it does |
|---|---|
| `PORT` | API + proxy listen port (default 8080) |
| `API_KEY` | required bearer token for the API |
| `DATA_DIR` | where instance workdirs live |
| `RUNNER_HOST` | the host the preview URLs are built from |
| `PREVIEW_DOMAIN` | wildcard domain for previews: `<id>.<domain>` |
| `DEV_PORT_BASE` | first port allocated to instance dev servers (4173+) |
| `MAX_INSTANCES` | most concurrent instances (and ports) allowed |
| `IDLE_TTL_MS` | how long an unasked-for preview lives |
| `SWEEP_INTERVAL_MS` | how often idle instances are swept |
| `MAX_BODY_BYTES` | body size cap for API requests |
| `COMMAND_TIMEOUT_SECONDS` | default per-command timeout |
| `LOG_CAP_BYTES` | ring-buffer cap per stream |

Previews are addressed by path (`/p/<instance>/…`) under the runner's own
host, so one hostname and one certificate cover every instance. The
host-based form (`<id>.<PREVIEW_DOMAIN>`) works too, when a wildcard
certificate and DNS are available.

## The image

`Dockerfile` builds the service into an image that also carries everything
a generated app needs — bun, and wrangler for the Workers apps:

```sh
docker build -t vibesdk-sandbox-agent:latest runner/
```

The build context is `runner/`, so nothing else in the repository is sent
to the daemon.

On Kubernetes, the pod wants the environment above and a volume for
`DATA_DIR`. A ready-made manifest — namespace, PVC, Deployment, Service —
is in the compose repository, at `stacks/vibesdk-sandbox/k8s/`.

## Development

```
npm run typecheck      # tsc -b, from the repository root
npm run test:runner    # the runner's own tests (node pool)
```

The runner is checked by the repository's typecheck and linted with
node's globals. Its tests run in the node pool rather than the Workers
pool, because it spawns processes.
