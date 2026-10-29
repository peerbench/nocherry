# PGlite Deployment

Run the commit-reveal server using [PGlite](https://pglite.dev) — a WASM-compiled
Postgres that runs entirely in-process. No external database server needed.

Data is persisted to disk by default (Postgres data directory at `./pgdata`).

## Setup

```bash
cd deploy/pglite
npm install
npm start
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `7420` | HTTP server port |
| `DATA_DIR` | `./pgdata` | PGlite data directory (filesystem path for persistence, or `memory://` for in-memory) |
| `RETENTION` | `30d` | Data retention period |
| `OPERATOR` | `Local Development (PGlite)` | Operator name shown in server-info |
| `VERIFY_REVEAL_DATA` | `true` | Verify reveal data against commitment |

## Examples

```bash
# Persistent (default) — data survives restarts
npm start

# In-memory — fast, no persistence
DATA_DIR=memory:// npm start

# Custom port and data location
PORT=8080 DATA_DIR=/var/lib/commit-reveal npm start
```

## Why PGlite?

- **Zero dependencies** — no Postgres server to install, configure, or maintain
- **Full Postgres** — real PostgreSQL via WebAssembly, not a subset
- **Disk persistence** — data directory on the local filesystem
- **Single process** — entire stack (HTTP + database) in one Node.js process
- **Portable** — works anywhere Node.js runs, no native compilation needed
