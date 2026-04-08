#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
ADMIN_TOKEN="${2:-${BOTCOW_ADMIN_TOKEN:-}}"
BATCH_LIMIT="${3:-10}"
MAX_LOOPS="${4:-500}"

if [[ -z "${ADMIN_TOKEN}" ]]; then
  echo "Error: admin token is missing." >&2
  echo "Usage: bash bootstrap_wix_rag.sh [BASE_URL] [ADMIN_TOKEN] [BATCH_LIMIT] [MAX_LOOPS]" >&2
  echo "Or export BOTCOW_ADMIN_TOKEN first." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 is required." >&2
  exit 1
fi

TMP_RESP="$(mktemp)"
trap 'rm -f "$TMP_RESP"' EXIT

call_api() {
  local method="$1"
  local url="$2"
  local body="${3:-}"

  local http_code

  if [[ -n "$body" ]]; then
    http_code="$(
      curl -sS \
        -o "$TMP_RESP" \
        -w "%{http_code}" \
        -X "$method" "$url" \
        -H "x-admin-token: $ADMIN_TOKEN" \
        -H "Content-Type: application/json" \
        --data "$body"
    )"
  else
    http_code="$(
      curl -sS \
        -o "$TMP_RESP" \
        -w "%{http_code}" \
        -X "$method" "$url" \
        -H "x-admin-token: $ADMIN_TOKEN"
    )"
  fi

  if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
    echo "HTTP $http_code from $url" >&2
    cat "$TMP_RESP" >&2
    exit 1
  fi

  python3 - <<'PY' "$TMP_RESP"
import json, sys
path = sys.argv[1]
try:
    data = json.load(open(path, "r", encoding="utf-8"))
except Exception as e:
    print(f"Invalid JSON response: {e}", file=sys.stderr)
    print(open(path, "r", encoding="utf-8").read(), file=sys.stderr)
    raise SystemExit(1)

if not data.get("ok"):
    print("API returned ok=false", file=sys.stderr)
    print(json.dumps(data, ensure_ascii=False, indent=2), file=sys.stderr)
    raise SystemExit(1)

print(json.dumps(data, ensure_ascii=False))
PY
}

json_get() {
  local key="$1"
  python3 - <<'PY' "$key"
import json, sys
key = sys.argv[1]
data = json.load(sys.stdin)
parts = key.split(".")
cur = data
for part in parts:
    if isinstance(cur, dict) and part in cur:
        cur = cur[part]
    else:
        raise SystemExit(1)
if isinstance(cur, (dict, list)):
    print(json.dumps(cur, ensure_ascii=False))
elif cur is None:
    print("")
else:
    print(cur)
PY
}

echo "==> Bootstrap Wix RAG"
echo "Base URL:   $BASE_URL"
echo "Batch size: $BATCH_LIMIT"
echo

BOOTSTRAP_JSON="$(call_api "POST" "$BASE_URL/api/admin/rag/bootstrap")"
echo "$BOOTSTRAP_JSON" | python3 - <<'PY'
import json, sys
data = json.load(sys.stdin)
r = data["result"]
print("Bootstrap started")
print(f"  sourceId:          {r.get('sourceId')}")
print(f"  jobId:             {r.get('jobId')}")
print(f"  totalSeedUrls:     {r.get('totalSeedUrls')}")
print(f"  createdDocuments:  {r.get('createdDocuments')}")
print(f"  existingDocuments: {r.get('existingDocuments')}")
PY

echo
echo "==> Running batches"
loop=0

while true; do
  loop=$((loop + 1))

  if [[ "$loop" -gt "$MAX_LOOPS" ]]; then
    echo "Error: reached MAX_LOOPS=$MAX_LOOPS before completion." >&2
    exit 1
  fi

  RUN_JSON="$(call_api "POST" "$BASE_URL/api/admin/rag/run" "{\"limit\": $BATCH_LIMIT}")"

  echo "$RUN_JSON" | python3 - <<'PY' "$loop"
import json, sys
loop = sys.argv[1]
data = json.load(sys.stdin)
r = data["result"]
print(f"Batch {loop}")
print(f"  jobId:      {r.get('jobId')}")
print(f"  processed:  {r.get('processed')}")
print(f"  ready:      {r.get('ready')}")
print(f"  failed:     {r.get('failed')}")
print(f"  deleted:    {r.get('deleted')}")
print(f"  remaining:  {r.get('remaining')}")
print(f"  done:       {r.get('done')}")
PY

  DONE_VALUE="$(printf '%s' "$RUN_JSON" | json_get "result.done")"
  if [[ "$DONE_VALUE" == "True" || "$DONE_VALUE" == "true" ]]; then
    break
  fi
done

echo
echo "==> Final status"
STATUS_JSON="$(call_api "GET" "$BASE_URL/api/admin/rag/status")"
echo "$STATUS_JSON" | python3 - <<'PY'
import json, sys
data = json.load(sys.stdin)
result = data["result"]

source = result.get("source") or {}
jobs = result.get("jobs") or []
counts = result.get("counts") or []

print("Source")
print(f"  id:      {source.get('id')}")
print(f"  key:     {source.get('key')}")
print(f"  status:  {source.get('status')}")
print()

print("Recent jobs")
if not jobs:
    print("  (none)")
else:
    for job in jobs:
        print(
            f"  {job.get('id')}  kind={job.get('kind')}  status={job.get('status')}  "
            f"queued={job.get('queuedCount')}  done={job.get('doneCount')}  failed={job.get('failedCount')}"
        )
print()

print("Document counts by status")
if not counts:
    print("  (none)")
else:
    for row in counts:
        print(f"  {row.get('status')}: {row.get('_count', {}).get('_all')}")
PY

echo
echo "Completed."