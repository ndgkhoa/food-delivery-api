# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24.14-slim
ARG RUNTIME_IMAGE=gcr.io/distroless/nodejs24-debian12:nonroot

FROM ${NODE_IMAGE} AS builder

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN git init -q .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .

ENV NODE_ENV=production
RUN pnpm nx run-many -t build \
    --projects gateway,catalog,auth,order,search,delivery,media,payment,config,review,analytics,inventory,notification \
    --configuration=production

FROM ${NODE_IMAGE} AS deps

WORKDIR /app

COPY --from=builder /workspace/dist/apps/ ./dist/apps/
COPY --from=builder /workspace/apps/payment/src/workflows/ ./workflows/
RUN rm -f ./workflows/*.spec.* ./workflows/*.test.*

RUN node -e "const fs=require('fs');const deps={};for(const a of fs.readdirSync('dist/apps')){const p=JSON.parse(fs.readFileSync('dist/apps/'+a+'/package.json'));Object.assign(deps,p.dependencies||{});}deps['pg']='8.22.0';const out={name:'food-delivery-api',version:'0.0.0',dependencies:deps,overrides:{'js-yaml@>=5.0.0 <5.2.2':'5.2.3'}};fs.writeFileSync('package.json',JSON.stringify(out,null,2));" \
    && npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force

FROM ${RUNTIME_IMAGE} AS runtime

ENV NODE_ENV=production
ENV TEMPORAL_WORKFLOWS_PATH=/app/workflows
WORKDIR /app

COPY --from=deps /app/ ./
COPY infra/docker/launcher.js ./launcher.js

USER 65532:65532

CMD ["launcher.js"]
