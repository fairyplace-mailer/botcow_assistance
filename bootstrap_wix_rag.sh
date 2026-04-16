#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
ADMIN_TOKEN="${2:-${BOTCOW_ADMIN_TOKEN:-}}"
SEED_BATCH="${3:-100}"
INGEST_BATCH="${4:-1}"
MAX_LOOPS="${5:-200}"
SKIP_SEED="${6:-0}"

if [[ -z "${ADMIN_TOKEN}" ]]; then
  echo "Error: BOTCOW_ADMIN_TOKEN is missing." >&2
  echo "Usage: bash bootstrap_wix_rag.sh [BASE_URL] [ADMIN_TOKEN] [SEED_BATCH] [INGEST_BATCH] [MAX_LOOPS] [SKIP_SEED]" >&2
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
        -H "Authorization: Bearer $ADMIN_TOKEN" \
        -H "Content-Type: application/json" \
        --data "$body"
    )"
  else
    http_code="$(
      curl -sS \
        -o "$TMP_RESP" \
        -w "%{http_code}" \
        -X "$method" "$url" \
        -H "Authorization: Bearer $ADMIN_TOKEN"
    )"
  fi

  if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
    echo "HTTP $http_code from $url" >&2
    cat "$TMP_RESP" >&2
    exit 1
  fi

  python3 - "$TMP_RESP" <<'PY'
import json, sys
path = sys.argv[1]
data = json.load(open(path, "r", encoding="utf-8"))
if not data.get("ok"):
    print(json.dumps(data, ensure_ascii=False, indent=2), file=sys.stderr)
    raise SystemExit(1)
print(json.dumps(data, ensure_ascii=False))
PY
}

json_get() {
  local json="$1"
  local key="$2"

  python3 - "$json" "$key" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
key = sys.argv[2]

cur = data
for part in key.split("."):
    if isinstance(cur, dict):
        cur = cur.get(part)
    else:
        cur = None
        break

if isinstance(cur, (dict, list)):
    print(json.dumps(cur, ensure_ascii=False))
elif cur is None:
    print("")
else:
    print(cur)
PY
}

print_seed_result() {
  local json="$1"
  local loop="$2"

  python3 - "$json" "$loop" <<'PY'
import json, sys
r = json.loads(sys.argv[1])["result"]
loop = sys.argv[2]
print(f"Seed batch {loop}")
print(f"  jobId:            {r.get('jobId')}")
print(f"  processed:        {r.get('processed')}")
print(f"  inserted:         {r.get('inserted')}")
print(f"  updated:          {r.get('updated')}")
print(f"  skipped:          {r.get('skipped')}")
print(f"  nextCursor:       {r.get('nextCursor')}")
print(f"  totalInManifest:  {r.get('totalInManifest')}")
PY
}

print_ingest_result() {
  local json="$1"
  local loop="$2"

  python3 - "$json" "$loop" <<'PY'
import json, sys
r = json.loads(sys.argv[1])["result"]
loop = sys.argv[2]
print(f"Ingest batch {loop}")
print(f"  jobId:             {r.get('jobId')}")
print(f"  fetched:           {r.get('fetched')}")
print(f"  stored:            {r.get('stored')}")
print(f"  skippedUnchanged:  {r.get('skippedUnchanged')}")
print(f"  chunksUpserted:    {r.get('chunksUpserted')}")
print(f"  stoppedReason:     {r.get('stoppedReason')}")
print(f"  budgetMode:        {r.get('budgetMode')}")
print(f"  activePages:       {r.get('officialPages')}")
print(f"  activeChunks:      {r.get('officialChunks')}")
PY
}

print_final_status() {
  local json="$1"

  python3 - "$json" <<'PY'
import json, sys
r = json.loads(sys.argv[1])["result"]
source = r.get("source") or {}
counts = r.get("counts") or {}
jobs = r.get("jobs") or []

print("Source")
print(f"  id:            {source.get('id')}")
print(f"  key:           {source.get('sourceKey')}")
print(f"  kind:          {source.get('sourceKind')}")
print(f"  status:        {source.get('status')}")
print()

print("Counts")
for key in ["pending", "fetched", "extracted", "embedded", "ready", "failed", "deleted"]:
    print(f"  {key}: {counts.get(key, 0)}")
print(f"  activeChunks:  {r.get('activeChunks')}")
print(f"  workRemaining: {r.get('workRemaining')}")
print()

print("Recent jobs")
if not jobs:
    print("  (none)")
else:
    for job in jobs[:5]:
        print(
            f"  {job.get('id')}  kind={job.get('jobKind')}  status={job.get('jobStatus')}  "
            f"processed={job.get('processed')}  inserted={job.get('inserted')}  "
            f"updated={job.get('updated')}  skipped={job.get('skipped')}"
        )
PY
}

echo "==> DevWix bootstrap"
echo "Base URL:      $BASE_URL"
echo "Seed batch:    $SEED_BATCH"
echo "Ingest batch:  $INGEST_BATCH"
echo "Max loops:     $MAX_LOOPS"
echo "Skip seed:     $SKIP_SEED"
echo

if [[ "$SKIP_SEED" != "1" ]]; then
  cursor=""
  seed_loop=0

  while true; do
    seed_loop=$((seed_loop + 1))
    if [[ "$seed_loop" -gt "$MAX_LOOPS" ]]; then
      echo "Error: seed loop exceeded MAX_LOOPS=$MAX_LOOPS" >&2
      exit 1
    fi

    url="$BASE_URL/api/admin/devwix/seed?batchLimit=$SEED_BATCH"
    if [[ -n "$cursor" ]]; then
      url="$url&cursor=$cursor"
    fi

    RESP="$(call_api "POST" "$url")"
    print_seed_result "$RESP" "$seed_loop"

    cursor="$(json_get "$RESP" "result.nextCursor")"
    if [[ -z "$cursor" || "$cursor" == "null" || "$cursor" == "None" ]]; then
      break
    fi
  done

  echo
else
  echo "==> Seed skipped"
  echo
fi

echo "==> DevWix ingest"
loop=0

while true; do
  loop=$((loop + 1))
  if [[ "$loop" -gt "$MAX_LOOPS" ]]; then
    echo "Error: ingest loop exceeded MAX_LOOPS=$MAX_LOOPS" >&2
    exit 1
  fi

  RESP="$(call_api "POST" "$BASE_URL/api/admin/devwix/ingest?limitPages=$INGEST_BATCH")"
  print_ingest_result "$RESP" "$loop"

  fetched="$(json_get "$RESP" "result.fetched")"
  stored="$(json_get "$RESP" "result.stored")"
  skipped="$(json_get "$RESP" "result.skippedUnchanged")"
  chunks="$(json_get "$RESP" "result.chunksUpserted")"
  stopped="$(json_get "$RESP" "result.stoppedReason")"

  if [[ "$stopped" == "budget_aggressive_stop" ]]; then
    echo
    echo "Stopped: budget is in aggressive mode."
    break
  fi

  if [[ "${fetched:-0}" == "0" && "${stored:-0}" == "0" && "${skipped:-0}" == "0" && "${chunks:-0}" == "0" ]]; then
    echo
    echo "No more immediate ingest work."
    break
  fi
done

echo
echo "==> Final status"
RESP="$(call_api "GET" "$BASE_URL/api/admin/devwix/status")"
print_final_status "$RESP"

echo
echo "Done."
