# The Publisher's image: the service that applies an app's stack to the
# cluster, and serves the deployed apps' traffic.
#
# The build context is this directory:
#
#   docker build -t vibesdk-publisher:latest publisher/
#
# The publisher has no dependencies: it talks to the API server with fetch
# and the service account's own token, so the image carries node and
# nothing else.
FROM node:24-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY src ./src
COPY protocol.ts ./
COPY package.json ./

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data

EXPOSE 8080
VOLUME ["/data"]

# tini is PID 1: it forwards the signals and reaps the orphans the apps'
# runtimes leave behind.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--experimental-strip-types", "--disable-warning=ExperimentalWarning", "src/server.ts"]
