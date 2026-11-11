# The builder's image.
#
# The build is two steps: the application bundle (esbuild, in builder/) and
# the client (vite, the repository's own build). The dependencies stay
# external — the bundle expects Node to load them — so they are installed
# here rather than bundled.
#
# The build context is the repository's root:
#
#   docker build -f builder/Dockerfile -t vibesdk-builder:latest .
FROM oven/bun:1 AS build

WORKDIR /src

# The whole repository, then the install: the lockfile's layout is the
# repository's, and a partial tree installs a different one.
COPY . .
RUN bun install --frozen-lockfile

# The application bundle, and the client it serves.
RUN bun run build:builder
RUN bun run build


FROM node:24-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# The dependencies, the bundle and the client.
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/builder/dist ./dist
COPY --from=build /src/dist/client ./dist/client
COPY --from=build /src/migrations ./migrations

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data \
    ASSETS_DIR=/app/dist/client \
    MIGRATIONS_DIR=/app/migrations \
    DATABASE_PATH=/data/builder.sqlite \
    SESSIONS_DIR=/data/sessions

EXPOSE 8080
VOLUME ["/data"]

# tini is PID 1: it forwards the signals and reaps the orphans the
# sessions' runtimes leave behind.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
