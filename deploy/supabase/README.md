# Supabase Deployment — Commit-Reveal Protocol

Deploy the commit-reveal protocol server as a Supabase Edge Function (Deno) with Postgres storage.

## Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) (v2.50+)
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)
- A Supabase project (create one at [supabase.com](https://supabase.com))
- `supabase login` completed (or `SUPABASE_ACCESS_TOKEN` env var)

## Quick Deploy

```bash
./setup.sh
```

The script will:
1. Build the WASM module with `--target web`
2. Prompt for your Supabase project ref
3. Link the project and apply database migrations
4. Optionally set OPERATOR and RETENTION secrets
5. Deploy the Edge Function
6. Run a health check

## Manual Deploy

```bash
# 1. Build WASM
cd ../../packages/pb-wasm
wasm-pack build --target web --release --out-dir ../../deploy/supabase/supabase/functions/commit-reveal/wasm/build
cp supabase/functions/commit-reveal/wasm/build/{pb_wasm_bg.wasm,pb_wasm.js,pb_wasm.d.ts} supabase/functions/commit-reveal/wasm/
rm -rf supabase/functions/commit-reveal/wasm/build

# 2. Link and migrate
cd supabase
supabase link --project-ref <your-ref>
supabase db push

# 3. Set secrets (optional)
supabase secrets set OPERATOR="My Org"
supabase secrets set RETENTION="30d"

# 4. Deploy
supabase functions deploy commit-reveal --no-verify-jwt
```

## Local Development

```bash
cd supabase
supabase start                        # Starts local Postgres + other services
supabase functions serve commit-reveal # Serves the function locally
```

The function will be available at `http://localhost:54321/functions/v1/commit-reveal`.

## Configuration

| Variable | Source | Description |
|----------|--------|-------------|
| `SUPABASE_DB_URL` | Auto-injected | Postgres connection string |
| `OPERATOR` | `supabase secrets set` | Operator name shown in /v1/server-info |
| `RETENTION` | `supabase secrets set` | Data retention period (e.g., "30d") |

## API Endpoints

All endpoints are served under the function path:

```
GET  /health                              → { "status": "ok" }
GET  /v1/server-info                      → Server metadata
POST /v1/commitments                      → Submit a commitment
GET  /v1/commitments/:hash                → Get commitment receipt
GET  /v1/commitments/:hash/selection      → Get selection result
POST /v1/commitments/:hash/reveals        → Submit a reveal
GET  /v1/commitments/:hash/reveals        → List reveals
```

## Architecture

```
supabase/
├── config.toml                           # JWT verification disabled
├── migrations/
│   └── 00001_init.sql                    # Postgres schema
└── functions/
    └── commit-reveal/
        ├── index.ts                      # Entry: init WASM → Postgres → key → serve
        ├── app.ts                        # Hono router factory
        ├── config.ts                     # Deno.env configuration
        ├── signing.ts                    # Ed25519 server key management
        ├── beacon.ts                     # drand beacon fetching
        ├── deps.ts                       # Centralized imports
        ├── storage/
        │   └── postgres.ts              # KyselyStorage + Postgres dialect
        ├── routes/
        │   ├── server-info.ts
        │   ├── commitments.ts
        │   └── reveals.ts
        └── wasm/
            ├── mod.ts                    # Deno WASM loader
            ├── pb_wasm_bg.wasm           # Built by setup.sh
            ├── pb_wasm.js               # ESM glue (--target web)
            └── pb_wasm.d.ts             # Type definitions
```

## Storage

Uses Kysely query builder with the Postgres dialect. The same `KyselyStorage` interface is used by the Node.js server (with SQLite) and this Edge Function (with Postgres), enabling near-identical business logic across both deployments.
