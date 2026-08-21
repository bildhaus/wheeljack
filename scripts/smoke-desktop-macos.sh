#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$ROOT/target/release/bundle/macos/wheeljack.app}"
BIN="$APP/Contents/MacOS/wheeljack-desktop"
if [[ ! -x "$BIN" ]]; then
  echo "wheeljack app executable was not found: $BIN" >&2
  exit 1
fi
PROFILE="$(mktemp -d "${TMPDIR:-/tmp}/wheeljack-tauri-ui-smoke-XXXXXX")"
cleanup() {
  if [[ "$PROFILE" != "${TMPDIR:-/tmp}"/wheeljack-tauri-ui-smoke-* ]]; then
    echo "Refusing unsafe smoke cleanup path: $PROFILE" >&2
    exit 1
  fi
  rm -rf "$PROFILE"
}
trap cleanup EXIT
RESULT="$PROFILE/ui-smoke-result.json"
run_smoke() {
  local phase="$1"
  rm -f "$RESULT"
  WHEELJACK_DESKTOP_DATA_DIR="$PROFILE" \
    WHEELJACK_UI_SMOKE=1 \
    WHEELJACK_UI_SMOKE_AUTO_CLOSE=1 \
    WHEELJACK_UPDATE_FEED_URL="http://127.0.0.1:1/offline" \
    "$BIN" --ui-smoke --ui-smoke-auto-close &
  local pid=$!
  for _ in $(seq 1 150); do
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    sleep 0.2
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    wait "$pid" || true
    echo "wheeljack did not close during the macOS $phase smoke." >&2
    exit 1
  fi
  wait "$pid"
  if [[ ! -f "$RESULT" ]] || ! grep -q '"ok":true' "$RESULT"; then
    echo "wheeljack macOS $phase smoke did not report success." >&2
    [[ -f "$RESULT" ]] && cat "$RESULT" >&2
    exit 1
  fi
  cat "$RESULT"
}

run_smoke "offline startup"
DB="$PROFILE/wheeljack.sqlite3"
FIRST_RECOVERY_COUNT="$(sqlite3 "$DB" "SELECT COUNT(*) FROM projects WHERE name = 'Smoke recovery';")"
run_smoke "same-profile relaunch recovery"
SECOND_RECOVERY_COUNT="$(sqlite3 "$DB" "SELECT COUNT(*) FROM projects WHERE name = 'Smoke recovery';")"
if (( SECOND_RECOVERY_COUNT <= FIRST_RECOVERY_COUNT )); then
  echo "wheeljack did not retain the first macOS smoke profile across relaunch." >&2
  exit 1
fi
