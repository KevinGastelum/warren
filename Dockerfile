# Warren container image (SPEC §10.3).
#
# Two-stage build:
#   1. ui-builder — build the React/Vite SPA into src/ui/dist.
#   2. runtime    — bun + bwrap + uidmap (from burrow-base), warren source,
#                   the four os-eco CLIs warren shells out to, and the SPA
#                   bundle copied from stage 1.
#
# The supervisor (src/supervisor/main.ts) is the ENTRYPOINT — it owns
# spawning + signal-forwarding + restart policy for `burrow serve` and
# warren's HTTP server. See SPEC §10.3 for the contract.
#
# The four `bwrap` security flags (apparmor=unconfined, seccomp=unconfined,
# systempaths=unconfined, cap_add=SYS_ADMIN) are applied by the orchestrator
# (docker-compose.yml or fly.toml), not the image. See SPEC §5.3 + §11.A
# and burrow's DEPLOY.md for the rationale.

# ---------- stage 1: build the UI ----------
FROM oven/bun:1.1 AS ui-builder
WORKDIR /ui-build
COPY src/ui/package.json src/ui/bun.lock src/ui/tsconfig.json ./
COPY src/ui/tsconfig.app.json src/ui/tsconfig.node.json ./
COPY src/ui/vite.config.ts src/ui/index.html ./
COPY src/ui/src ./src
RUN bun install --frozen-lockfile
RUN bun run build

# ---------- stage 2: runtime ----------
FROM ghcr.io/jayminwest/burrow-base:0.2.0

# os-eco CLIs warren shells out to during run setup, reap, and project
# management. Versions track each tool's current release; bumping them
# is a deliberate image-rebuild decision.
RUN bun install -g \
    @os-eco/canopy-cli@0.7.0 \
    @os-eco/seeds-cli@0.4.0 \
    @os-eco/mulch-cli@0.8.0 \
    @os-eco/sapling-cli@0.3.0

WORKDIR /app

# Server-side dependencies. Copy lockfiles first so a code-only edit
# doesn't bust the bun install layer.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production=false

# Source. Excludes are listed in .dockerignore (node_modules, data, .env,
# src/ui/node_modules, src/ui/dist) so we don't ship dev artefacts.
COPY . /app

# Pull the prebuilt UI bundle from stage 1.
COPY --from=ui-builder /ui-build/dist /app/src/ui/dist

# Default data root — the deploy mounts a persistent volume here.
ENV WARREN_DATA_DIR=/data
ENV WARREN_BURROW_SOCKET=/var/run/burrow.sock

# /data is a persistence boundary (sqlite + cloned canopy + cloned project
# repos). /var/run is where the supervisor binds burrow's unix socket; the
# directory must exist for `burrow serve --socket /var/run/burrow.sock`.
RUN mkdir -p /data /var/run

EXPOSE 8080

ENTRYPOINT ["bun", "run", "src/supervisor/main.ts"]
