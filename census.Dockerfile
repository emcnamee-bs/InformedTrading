# Insider census daemon — its own Node-18 image (matches the repo's runtime + better-sqlite3 ABI).
# Runs as a SECOND container on Ai1, bind-mounting /app/state to read the poller's spine.db and
# write insider.db. Never calls Kalshi; no secrets.
FROM node:18-bookworm-slim
# better-sqlite3 compiles a native binding at install time — needs a toolchain in the build stage.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
ENV AI1_DB=/app/state/spine.db
ENV INSIDER_DB=/app/state/insider.db
ENV CENSUS_INTERVAL_SECONDS=600
CMD ["npx", "tsx", "src/census/runner.ts"]
