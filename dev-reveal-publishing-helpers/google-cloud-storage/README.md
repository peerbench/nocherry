# Reveal Publishing Helper — Google Cloud Storage

Dev infrastructure for testing the reveal publishing flow. Accepts uploaded files with a verified receipt and stores them in Google Cloud Storage.

**This is NOT part of the core commit-reveal protocol.** Server operators do not need to run this.

## Setup

### 1. Create GCS bucket

```bash
gsutil mb gs://your-reveal-bucket
```

### 2. Copy WASM files

```bash
cp ../../pkg/pb_wasm.js ../../pkg/pb_wasm_bg.wasm src/wasm/
```

### 3. Set environment variables

```bash
export GCS_BUCKET=your-reveal-bucket
export GOOGLE_CLOUD_PROJECT=your-project-id
```

### 4. Install and run

```bash
npm install
node src/server.js
```

## Deploy to Cloud Run

```bash
# Copy WASM first
cp ../../pkg/pb_wasm.js ../../pkg/pb_wasm_bg.wasm src/wasm/

# Build and deploy
docker build -t reveal-gcs .
gcloud run deploy reveal-gcs \
  --image reveal-gcs \
  --set-env-vars GCS_BUCKET=your-reveal-bucket \
  --allow-unauthenticated
```

## API

### `POST /v1/upload`

Upload revealed files with a receipt for verification.

```bash
curl -X POST http://localhost:8080/v1/upload \
  -F 'receipt=@/tmp/receipt.json' \
  -F 'files[]=@/tmp/result-01.json'
```

### `GET /v1/data/:hash/:filename`

Retrieve a previously uploaded file.

```bash
curl http://localhost:8080/v1/data/<commitment_hash>/result-01.json
```

### `GET /health`

Health check probing GCS accessibility.
