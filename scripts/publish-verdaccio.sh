#!/usr/bin/env bash
# Build/publish four @nocherry packages to Verdaccio on forest-box.
# Run on a machine with the repo and npm-auth available; this replaces the dead
# `nocherry-publish` Cloud Build trigger. It is intentionally manual while we finish
# the GCP exodus — no CI system receives a key to forest-box.
set -euo pipefail

REGISTRY="https://npm.dev.peerbench.ai/"
: "${FOREST_NPM_USER:?Set FOREST_NPM_USER (for example: mdk)}"
: "${FOREST_NPM_PASSWORD:?Set FOREST_NPM_PASSWORD}"

AUTH="$(printf '%s:%s' "$FOREST_NPM_USER" "$FOREST_NPM_PASSWORD" | base64 | tr -d '\n')"
TMP_NPMRC="$(mktemp)"
trap 'rm -f "$TMP_NPMRC"' EXIT
printf '@nocherry:registry=%s\n//npm.dev.peerbench.ai/:_auth=%s\n' "$REGISTRY" "$AUTH" > "$TMP_NPMRC"
export NPM_CONFIG_USERCONFIG="$TMP_NPMRC"

npm install --ignore-scripts
npm run build -w @nocherry/sdk
npm run build -w @nocherry/storage
npm run build -w @nocherry/server

VER="0.0.$(date -u +%Y%m%d%H%M%S)"

# Keep local workspace links during build; pin published metadata only after builds finish.
(
  cd pkg
  npm version "$VER" --no-git-tag-version
  npm publish --registry="$REGISTRY"
)
(
  cd packages/pb-js
  npm pkg set "dependencies.@nocherry/pb-wasm=$VER"
  npm version "$VER" --no-git-tag-version
  npm publish --registry="$REGISTRY"
)
(
  cd packages/storage
  npm version "$VER" --no-git-tag-version
  npm publish --registry="$REGISTRY"
)
(
  cd packages/pb-node
  npm pkg set "dependencies.@nocherry/pb-wasm=$VER"
  npm pkg set "dependencies.@nocherry/storage=$VER"
  npm version "$VER" --no-git-tag-version
  npm publish --registry="$REGISTRY"
)

echo "Published @nocherry packages at $VER to $REGISTRY"
