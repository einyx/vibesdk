# The Runner's image: the service plus every generated app's dev server,
# all in one pod. bun and workerd must be present because the generated
# apps install with `bun install` and serve with vite — and the Workers
# apps (think projects) serve with wrangler, which runs workerd.
#
# The build context is this directory:
#
#   docker build -t vibesdk-sandbox-agent:latest runner/
FROM node:24-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/*

# bun, without curl|bash at runtime: copy the binaries from the official
# image. bunx is how dev servers reach the project's local vite.
COPY --from=oven/bun:1 --chown=root:root /usr/local/bin/bun /usr/local/bin/bun
COPY --from=oven/bun:1 --chown=root:root /usr/local/bin/bunx /usr/local/bin/bunx

# wrangler (and the workerd it ships) — the runtime for Workers apps.
# Pinned to the version this repo's own toolchain uses: the newer release's
# workerd grew its V8 heap without bound on Durable Object apps and the pod
# was OOM-killed mid-preview.
RUN npm install -g wrangler@4.90.0 \
    && npm cache clean --force

WORKDIR /app
COPY src ./src
COPY package.json ./

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    DEV_PORT_BASE=4173

EXPOSE 8080
VOLUME ["/data"]

# tini is PID 1: it forwards the signals to the agent and reaps the
# orphans the dev servers leave behind when they are killed.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--experimental-strip-types", "--disable-warning=ExperimentalWarning", "src/server.ts"]
