#!/usr/bin/env bash
#
# Supabase Edge Function deployment script for commit-reveal.
#
# Usage:
#   ./setup.sh                        # Interactive — prompts for project ref
#   ./setup.sh <project-ref>          # Non-interactive
#   SUPABASE_PROJECT_REF=xyz ./setup.sh  # Via env var
#
# Prerequisites:
#   - Supabase CLI (v2.50+): https://supabase.com/docs/guides/cli
#   - wasm-pack: https://rustwasm.github.io/wasm-pack/installer/
#   - Authenticated: `supabase login` or SUPABASE_ACCESS_TOKEN env var
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WASM_CRATE="$MONO_ROOT/packages/pb-wasm"
WASM_OUT="$SCRIPT_DIR/supabase/functions/commit-reveal/wasm"
SUPABASE_DIR="$SCRIPT_DIR/supabase"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1" >&2; exit 1; }

# ── 1. Check prerequisites ──

echo "=== Supabase Edge Function Deploy ==="
echo

# Supabase CLI
if ! command -v supabase &>/dev/null; then
  error "supabase CLI not found. Install: https://supabase.com/docs/guides/cli"
fi

SB_VERSION=$(supabase --version 2>&1 | grep -oE '[0-9]+\.[0-9]+' | head -1)
info "Supabase CLI found (v$SB_VERSION)"

# wasm-pack
if ! command -v wasm-pack &>/dev/null; then
  error "wasm-pack not found. Install: curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh"
fi
info "wasm-pack found"

# ── 2. Build WASM with --target web ──

echo
echo "Building WASM (--target web)..."
cd "$WASM_CRATE"
wasm-pack build --target web --release --out-dir "$WASM_OUT/build"

# Copy artifacts into the function's wasm/ directory
cp "$WASM_OUT/build/pb_wasm_bg.wasm" "$WASM_OUT/pb_wasm_bg.wasm"
cp "$WASM_OUT/build/pb_wasm.js"      "$WASM_OUT/pb_wasm.js"
cp "$WASM_OUT/build/pb_wasm.d.ts"    "$WASM_OUT/pb_wasm.d.ts"
rm -rf "$WASM_OUT/build"

info "WASM artifacts copied to function directory"

# ── 2b. Sync shared core from monorepo ──

CORE_SRC="$MONO_ROOT/src/core"
CORE_DST="$SCRIPT_DIR/supabase/functions/commit-reveal/core"

echo "Syncing shared core..."
rm -rf "$CORE_DST"
cp -r "$CORE_SRC" "$CORE_DST"
info "Core synced from src/core/"

# ── 3. Get project ref ──

PROJECT_REF="${1:-${SUPABASE_PROJECT_REF:-}}"

if [ -z "$PROJECT_REF" ]; then
  echo
  read -rp "Enter your Supabase project ref: " PROJECT_REF
fi

if [ -z "$PROJECT_REF" ]; then
  error "Project ref is required"
fi

info "Project ref: $PROJECT_REF"

# ── 4. Link project ──

echo
echo "Linking to Supabase project..."
cd "$SUPABASE_DIR"
supabase link --project-ref "$PROJECT_REF"
info "Project linked"

# ── 5. Apply database migrations ──

echo
echo "Applying database migrations..."
supabase db push
info "Migrations applied"

# ── 6. Configure secrets (optional) ──

echo
echo "--- Optional: Configure environment variables ---"
echo "  OPERATOR and RETENTION can be set via supabase secrets."
echo "  SUPABASE_DB_URL is auto-injected."
echo

read -rp "Set OPERATOR name? (press Enter to skip): " OPERATOR
if [ -n "$OPERATOR" ]; then
  supabase secrets set "OPERATOR=$OPERATOR"
  info "OPERATOR set to: $OPERATOR"
fi

read -rp "Set RETENTION period? (e.g., 30d, 7d — press Enter to skip): " RETENTION
if [ -n "$RETENTION" ]; then
  supabase secrets set "RETENTION=$RETENTION"
  info "RETENTION set to: $RETENTION"
fi

# ── 7. Deploy the Edge Function ──

echo
echo "Deploying Edge Function..."
supabase functions deploy commit-reveal --no-verify-jwt
info "Edge Function deployed"

# ── 8. Smoke test ──

echo
FUNCTION_URL="https://$PROJECT_REF.supabase.co/functions/v1/commit-reveal"

echo "Running smoke test..."
HEALTH=$(curl -sf "$FUNCTION_URL/health" 2>/dev/null || echo "FAILED")

if echo "$HEALTH" | grep -q '"ok"'; then
  info "Health check passed"
else
  warn "Health check failed or timed out. The function may need a moment to start."
  warn "Try: curl $FUNCTION_URL/health"
fi

echo
echo "=== Deployment Complete ==="
echo
echo "  Function URL: $FUNCTION_URL"
echo "  Health:       $FUNCTION_URL/health"
echo "  Server Info:  $FUNCTION_URL/v1/server-info"
echo
echo "  Local dev:    cd supabase && supabase start && supabase functions serve commit-reveal"
echo
