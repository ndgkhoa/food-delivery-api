# syntax=docker/dockerfile:1.7

# One parameterized image builds ANY of the 13 NestJS services in this Nx
# monorepo — DRY instead of 13 near-identical Dockerfiles. Build with:
#   docker build -f infra/docker/Dockerfile --build-arg APP=catalog -t food-delivery/catalog:dev .
# (build context MUST be the repo root — the builder stage needs the whole
# workspace to resolve the Nx project graph).

ARG NODE_IMAGE=node:24.14-slim

# =============================================================================
# builder — installs the full pnpm workspace, then builds the target app's
# webpack bundle (dist/apps/<APP>/main.js) plus its generatePackageJson'd
# package.json and copied runtime assets (.proto files; for payment, the
# Temporal workflow source lives at apps/payment/src/workflows and is picked
# up straight from the workspace copy below — no separate copy step needed).
# =============================================================================
FROM ${NODE_IMAGE} AS builder

# Fails fast with a clear message instead of a confusing "Cannot find module"
# deep in the Nx build if the caller forgets --build-arg APP=<app-name>.
ARG APP
RUN test -n "$APP" || { echo "ERROR: --build-arg APP=<app-name> is required" >&2; exit 1; }

# Corepack ships with Node but is opt-in; pin the exact pnpm version the
# workspace uses (package.json#packageManager) so resolution matches CI/dev.
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

# git is required at install time: the root package.json's `prepare` script
# runs `lefthook install`, which shells out to git. node:slim is Debian-based
# and does not ship git by default.
# DL3008 (pin apt package versions): deliberately unpinned — the exact
# Debian package version drifts with every `node:24.14-slim` base bump
# (Renovate keeps NODE_IMAGE current), so a hardcoded version would break the
# build the next time the base image updates. `apt-get update` in the same
# RUN layer already guarantees the newest available build, which is the
# desired behaviour for a build-time-only tool that never ships in the image.
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Install deps in their own layer, cached until the lockfile/manifests change —
# avoids re-installing ~1000 packages on every source edit. The root
# package.json's `prepare` script runs `lefthook install`, which needs SOME
# git repo to register hooks into; `.git` itself is excluded from the build
# context (.dockerignore), so a throwaway repo satisfies it harmlessly — it
# never leaves this layer, let alone the runtime image.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN git init -q .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Now the rest of the workspace (Nx needs the full project graph to build any
# single app — cross-app source is still excluded via .dockerignore).
COPY . .

ENV NODE_ENV=production
RUN pnpm nx build "$APP" --configuration=production

# =============================================================================
# runtime — copies only the built bundle + its generated (pruned) package.json
# into a slim, non-root image. `npm install` (not pnpm) is deliberate: the
# generated package.json is a plain, self-contained manifest, so plain npm
# avoids re-provisioning pnpm/corepack in the runtime stage.
# =============================================================================
FROM ${NODE_IMAGE} AS runtime

ARG APP
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /workspace/dist/apps/${APP}/ ./
# Always copy Temporal's workflow source (present in every build regardless of
# APP — the builder stage copies the whole workspace). Only payment's worker
# reads TEMPORAL_WORKFLOWS_PATH; the few KB of TS source is a no-op for every
# other service. Cheaper than special-casing the Dockerfile per app.
COPY --from=builder /workspace/apps/payment/src/workflows/ ./workflows/
# Drop test sources from the runtime image — Temporal bundles from the workflows
# entry point and never imports a `.spec`, so it's dead weight, but no test code
# belongs in a production image.
RUN rm -f ./workflows/*.spec.* ./workflows/*.test.*
ENV TEMPORAL_WORKFLOWS_PATH=/app/workflows

# TypeORM loads its DB driver through a RUNTIME `require('pg')`, not a static
# import — so webpack's `generatePackageJson` can't see it and the pruned
# manifest omits `pg`, leaving every DB-backed service unable to connect
# ("DriverPackageNotInstalledError"). Add it explicitly, pinned to the version
# the workspace root declares (`pg@^8.22.0`); bump here in lockstep if root does.
# A no-op weight for the driverless services (gateway/search/delivery).
RUN npm install --omit=dev --no-audit --no-fund \
    && npm install --no-audit --no-fund --save=false pg@8.22.0 \
    && npm cache clean --force

# The official Node image already ships a least-privilege `node` user
# (uid/gid 1000) — reuse it instead of provisioning a new one.
# DL3066 (prefer numeric UID): `node` resolves via /etc/passwd baked into
# every node:*-slim image (uid 1000), so it works on any host that runs this
# image unmodified; the named form stays self-documenting for maintainers.
# hadolint ignore=DL3066
USER node

CMD ["node", "main.js"]
