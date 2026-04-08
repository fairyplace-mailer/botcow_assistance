#!/usr/bin/env bash
set -euo pipefail

OUT_PATH="${1:-docs/rag/dev_wix.seed.txt}"
TMP_RAW="$(mktemp)"
TMP_OUT="$(mktemp)"
trap 'rm -f "$TMP_RAW" "$TMP_OUT"' EXIT

mkdir -p "$(dirname "$OUT_PATH")"

curl -fsSL 'https://dev.wix.com/docs/llms.txt' > "$TMP_RAW"

python3 - "$TMP_RAW" > "$TMP_OUT" <<'PY'
import re
import sys
from urllib.parse import urlsplit, urlunsplit

src_path = sys.argv[1]
text = open(src_path, "r", encoding="utf-8").read()

# Extract all absolute dev.wix.com docs URLs from llms.txt
urls = set(re.findall(r'https://dev\.wix\.com/docs/[^\s)\]>"\']+', text))

allowed_prefixes = (
    "https://dev.wix.com/docs/api-reference/",
    "https://dev.wix.com/docs/develop-websites/",
    "https://dev.wix.com/docs/build-apps/",
    "https://dev.wix.com/docs/go-headless/",
)

exclude_exact = {
    "https://dev.wix.com/docs/api-reference",
    "https://dev.wix.com/docs/develop-websites",
    "https://dev.wix.com/docs/build-apps",
    "https://dev.wix.com/docs/go-headless",
}

cleaned = set()

for raw in urls:
    raw = raw.rstrip(".,;:!?)]}>'\"")

    parts = urlsplit(raw)
    url = urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))

    if url.endswith(".md"):
        url = url[:-3]

    if url.endswith("/"):
        url = url[:-1]

    if not any(url.startswith(prefix.rstrip("/")) for prefix in allowed_prefixes):
        continue

    if url in exclude_exact:
        continue

    if "/changelog" in url:
        continue

    cleaned.add(url)

for url in sorted(cleaned):
    print(url)
PY

if [[ ! -s "$TMP_OUT" ]]; then
  echo "Error: extracted seed list is empty" >&2
  exit 1
fi

mv "$TMP_OUT" "$OUT_PATH"
echo "Saved to $OUT_PATH"
wc -l "$OUT_PATH"