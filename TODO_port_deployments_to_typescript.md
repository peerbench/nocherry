# TODO: Port Deployment Packages to TypeScript

> **Status:** The library packages (pb-storage, pb-node, pb-js) have been migrated to TypeScript and build to `dist/`. However, **no deployed servers are running the new TypeScript builds yet**. All production/staging deployments still run the original JS source directly. Do not update deployments until the new builds have been thoroughly validated.

## Deployment packages that need review

Each of these has its own `src/` directory with JS files. They may also import from the library packages via relative paths that need checking.

### 1. Cloudflare Workers — commit-reveal server

- **Location:** `deploy/cloudflare/`
- `wrangler.toml` → `main = "src/index.js"`
- Needs: migrate `src/index.js` to TS, add tsup build, update wrangler entry to `dist/index.js`

### 2. Google Cloud Run — commit-reveal server

- **Location:** `deploy/google-cloud/`
- `Dockerfile` → `COPY src/ ./src/` + `CMD ["node", "src/server.js"]`
- `package.json` → `"start": "node src/server.js"`
- Needs: migrate source to TS, add build step to Dockerfile, update paths to `dist/`

### 3. Cloudflare R2 — reveal publish worker

- **Location:** `dev-reveal-publishing-helpers/cloudflare-r2/`
- `wrangler.toml` → `main = "src/index.js"`
- Needs: same as Cloudflare Workers above

### 4. Google Cloud Storage — reveal publish helper

- **Location:** `dev-reveal-publishing-helpers/google-cloud-storage/`
- `Dockerfile` → `COPY src/ ./src/` + `CMD ["node", "src/server.js"]`
- `package.json` → `"start": "node src/server.js"`
- Needs: same as Google Cloud Run above

## No changes needed

- `deploy/supabase/` — Deno runtime, no `src/` path references
- `packages/pb-storage` — already migrated, exports from `dist/`
- `packages/pb-node` — already migrated, exports from `dist/`
- `packages/pb-js` — already migrated, exports from `dist/`
- `packages/pb-demo` — stays JS, imports already fixed to point to `dist/`

## Important: check relative imports

Each deployment package may import from the library packages via relative paths like `../../packages/pb-node/src/app.js`. These would break since the source files are now `.ts`. Check each deployment's `src/` files for such imports and update them to use `dist/` paths or proper package exports.
