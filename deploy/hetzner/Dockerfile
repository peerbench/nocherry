# forest-box (Hetzner) deployment of the commit-reveal server: the same server as
# deploy/google-cloud, but with Postgres instead of Firestore (Cloud Run and Firestore
# left with the 2026-11 GCP migration). `@nocherry/storage` already ships a Kysely
# Postgres adapter, so only the storage wiring differs from the google-cloud deployment.
#
# Build context: repo root.
#   docker build -f deploy/hetzner/Dockerfile \
#     --secret id=npm_auth,src=./npm_auth -t commit-reveal .
# `npm_auth` = base64("user:password") for our private npm registry (npm.dev.peerbench.ai),
# needed for @nocherry/pb-wasm. Runtime needs DATABASE_URL (see compose.yaml).

FROM node:22-slim AS builder
WORKDIR /app

COPY deploy/hetzner/package.json deploy/hetzner/package-lock.json deploy/hetzner/.npmrc ./
RUN --mount=type=secret,id=npm_auth \
 printf '//npm.dev.peerbench.ai/:_auth=%s\n' "$(cat /run/secrets/npm_auth)" >> .npmrc \
 && npm ci \
 && sed -i '/_auth=/d' .npmrc

# Core server code, the storage layer it is built on, and this deployment's entry point.
# Sources are used directly (Node runs TypeScript through type stripping), so the image
# cannot drift from the published npm packages.
COPY src/core/ /app/src/core/
COPY packages/storage/ /app/packages/storage/
COPY deploy/hetzner/src/ /app/deploy/hetzner/src/
# `@nocherry/storage` is imported by bare specifier but lives in this repo here. Its
# sources import compiled-style ("./storage.js"), which Node's type stripping does not
# rewrite to ".ts", so the package is bundled once with esbuild (no type declarations
# needed at runtime).
RUN mkdir -p /app/node_modules/@nocherry \
 && ln -s /app/packages/storage /app/node_modules/@nocherry/storage \
 && cd /app/packages/storage \
 && npx esbuild src/*.ts --outdir=dist --format=esm --platform=node --packages=external

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/deploy ./deploy

# Unprivileged: the process keeps no state on disk, Postgres holds everything.
USER node

EXPOSE 8080
CMD ["node", "--experimental-strip-types", "deploy/hetzner/src/server.ts"]
