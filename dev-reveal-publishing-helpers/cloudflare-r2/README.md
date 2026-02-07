# Reveal Publishing Helper — Cloudflare R2

Dev infrastructure for testing the reveal publishing flow. Accepts uploaded files with a verified receipt and stores them in Cloudflare R2.

**This is NOT part of the core commit-reveal protocol.** Server operators do not need to run this.

## Setup

### 1. Create R2 bucket

```bash
npx wrangler r2 bucket create reveal-data
```

### 2. Create D1 database

```bash
npx wrangler d1 create reveal-store-db
```

Update the `database_id` in `wrangler.toml` with the ID from the output.

### 3. Run migration

```bash
npx wrangler d1 execute reveal-store-db --file=./migrations/0001_init.sql
```

### 4. Copy WASM files

```bash
cp ../../pkg/pb_wasm.js ../../pkg/pb_wasm_bg.wasm src/wasm/
```

### 5. Deploy

```bash
npx wrangler deploy
```

## Local development

```bash
cp ../../pkg/pb_wasm.js ../../pkg/pb_wasm_bg.wasm src/wasm/
npx wrangler dev
```

## API

### `POST /v1/upload`

Upload revealed files with a receipt for verification.

```bash
curl -X POST http://localhost:8787/v1/upload \
  -F 'receipt=@/tmp/receipt.json' \
  -F 'files[]=@/tmp/result-01.json'
```

### `GET /v1/data/:hash/:filename`

Retrieve a previously uploaded file.

```bash
curl http://localhost:8787/v1/data/<commitment_hash>/result-01.json
```

### `GET /health`

Health check probing R2 accessibility.
