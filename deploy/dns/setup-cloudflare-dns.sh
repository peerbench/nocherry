#!/usr/bin/env bash
#
# Create DNS CNAME records for peerbench.ai subdomains on Cloudflare.
#
# Prerequisites:
#   1. Create a Cloudflare API token at:
#      https://dash.cloudflare.com/profile/api-tokens
#   2. Use the "Edit zone DNS" template, scoped to peerbench.ai
#   3. Export it:  export CLOUDFLARE_API_TOKEN="your-token-here"
#
# Usage:
#   ./setup-cloudflare-dns.sh          # create all records
#   ./setup-cloudflare-dns.sh --dry-run  # preview without creating
#

set -euo pipefail

ZONE_ID="b1ce9706fc511834398c91cf2e1e0779"
API_BASE="https://api.cloudflare.com/client/v4"

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "Error: CLOUDFLARE_API_TOKEN is not set."
  echo ""
  echo "Create one at: https://dash.cloudflare.com/profile/api-tokens"
  echo "  -> Use template: 'Edit zone DNS'"
  echo "  -> Scope to zone: peerbench.ai"
  echo ""
  echo "Then run:  export CLOUDFLARE_API_TOKEN=\"your-token\""
  exit 1
fi

DRY_RUN=false
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=true
  echo "=== DRY RUN — no records will be created ==="
  echo ""
fi

# DNS records to create: subdomain -> CNAME target
# Proxied records (orange cloud) go through Cloudflare's CDN/proxy.
# For Cloudflare Workers targets, proxied=true is required.
# For external targets (Supabase, GCP), proxied=false uses DNS-only.

declare -a RECORDS=(
  # Dev commit-reveal servers
  "commit-reveal-cloudflare-dev.peerbench.ai|commit-reveal.orgtopus.workers.dev|true"
  "commit-reveal-supabase-dev.peerbench.ai|zgyneuohwbzufajusohz.supabase.co|false"
  "commit-reveal-gcp-dev.peerbench.ai|commit-reveal-323104702830.us-central1.run.app|false"

  # Reveal publishers
  "publish-cloudflare-dev.peerbench.ai|reveal-r2.orgtopus.workers.dev|true"
  "publish-gcp-dev.peerbench.ai|reveal-gcs-323104702830.us-central1.run.app|false"

  # Nocherry (production rebrand) — placeholder CNAMEs
  # Update the targets once production deployments exist.
  "nocherry.peerbench.ai|commit-reveal.orgtopus.workers.dev|true"
  "nocherry-1-dev.peerbench.ai|commit-reveal.orgtopus.workers.dev|true"
)

created=0
skipped=0
failed=0

for record in "${RECORDS[@]}"; do
  IFS='|' read -r name target proxied <<< "$record"

  echo "--- ${name} -> ${target} (proxied=${proxied})"

  if $DRY_RUN; then
    echo "    [dry-run] would create CNAME record"
    echo ""
    continue
  fi

  # Check if record already exists
  existing=$(curl -s -X GET \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    "${API_BASE}/zones/${ZONE_ID}/dns_records?type=CNAME&name=${name}" \
  )

  count=$(echo "$existing" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result_info',{}).get('count',0))" 2>/dev/null || echo "0")

  if [ "$count" != "0" ]; then
    echo "    [skip] Record already exists"
    skipped=$((skipped + 1))
    echo ""
    continue
  fi

  # Create the CNAME record
  result=$(curl -s -X POST \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{
      \"type\": \"CNAME\",
      \"name\": \"${name}\",
      \"content\": \"${target}\",
      \"proxied\": ${proxied},
      \"ttl\": 1,
      \"comment\": \"nocherry commit-reveal dev infrastructure\"
    }" \
    "${API_BASE}/zones/${ZONE_ID}/dns_records"
  )

  success=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success', False))" 2>/dev/null || echo "False")

  if [ "$success" = "True" ]; then
    echo "    [ok] Created successfully"
    created=$((created + 1))
  else
    echo "    [FAIL] $(echo "$result" | python3 -c "import sys,json; errs=json.load(sys.stdin).get('errors',[]); print(errs[0].get('message','unknown') if errs else 'unknown')" 2>/dev/null)"
    failed=$((failed + 1))
  fi
  echo ""
done

echo "=== Summary ==="
echo "Created: ${created}"
echo "Skipped: ${skipped}"
if [ "$failed" -gt 0 ]; then
  echo -e "\033[31mFailed:  ${failed}\033[0m"
else
  echo "Failed:  ${failed}"
fi
