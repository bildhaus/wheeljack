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
FIXTURE_HOME="$PROFILE/home"
FIXTURE_PREFIX="$PROFILE/npm-prefix"
FIXTURE_BIN="$FIXTURE_PREFIX/bin"
FIXTURE_SHELL="$PROFILE/login-shell"
FIXTURE_PACKAGE_ROOT="$FIXTURE_PREFIX/lib/node_modules/@anthropic-ai/claude-code"
mkdir -p "$FIXTURE_HOME" "$FIXTURE_BIN" "$FIXTURE_PACKAGE_ROOT"
printf '%s\n' '{"name":"@anthropic-ai/claude-code","version":"1.0.0","bin":{"claude":"cli.js"}}' > "$FIXTURE_PACKAGE_ROOT/package.json"
cat > "$FIXTURE_SHELL" <<'EOF'
#!/bin/sh
if [ "${1:-}" = "-l" ] && [ "${2:-}" = "-i" ] && [ "${3:-}" = "-c" ]; then
  export PATH="$WHEELJACK_ADAPTER_SMOKE_BIN:/usr/bin:/bin"
  exec /bin/sh -c "$4"
fi
exec /bin/sh "$@"
EOF
cat > "$FIXTURE_BIN/claude" <<'EOF'
#!/bin/sh
if [ "${1:-}" = "--version" ]; then
  printf '%s\n' 'wheeljack adapter fixture 1.0.0'
elif [ "${1:-}" = "auth" ] && [ "${2:-}" = "status" ]; then
  printf '%s\n' '{"loggedIn":true}'
else
  printf '%s\n' '{"result":"WHEELJACK_READY"}'
fi
EOF
cat > "$FIXTURE_BIN/npm" <<'EOF'
#!/bin/sh
if [ "${1:-}" = "root" ] && [ "${2:-}" = "--global" ]; then
  printf '%s\n' "$WHEELJACK_ADAPTER_SMOKE_PREFIX/lib/node_modules"
elif [ "${1:-}" = "prefix" ] && [ "${2:-}" = "--global" ]; then
  printf '%s\n' "$WHEELJACK_ADAPTER_SMOKE_PREFIX"
else
  exit 1
fi
EOF
chmod +x "$FIXTURE_SHELL" "$FIXTURE_BIN/claude" "$FIXTURE_BIN/npm"
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
    WHEELJACK_ADAPTER_SMOKE_BIN="$FIXTURE_BIN" \
    WHEELJACK_ADAPTER_SMOKE_ID="claude-code" \
    WHEELJACK_ADAPTER_SMOKE_PREFIX="$FIXTURE_PREFIX" \
    WHEELJACK_ADAPTER_UPDATE_SMOKE_MANAGER="npm" \
    WHEELJACK_UPDATE_FEED_URL="http://127.0.0.1:1/offline" \
    HOME="$FIXTURE_HOME" \
    PATH="/usr/bin:/bin" \
    SHELL="$FIXTURE_SHELL" \
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
