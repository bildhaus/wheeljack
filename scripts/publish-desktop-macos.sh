#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT="$ROOT/artifacts/desktop/macos"
TARGET="${WHEELJACK_MACOS_TARGET:-universal-apple-darwin}"
TARGET_ROOT="$ROOT/target${TARGET:+/$TARGET}/release"
BUNDLE_ROOT="$TARGET_ROOT/bundle"
case "$OUTPUT" in
  "$ROOT"/artifacts/desktop/macos) ;;
  *) echo "Refusing unsafe desktop output: $OUTPUT" >&2; exit 1 ;;
esac
case "$BUNDLE_ROOT" in
  "$ROOT"/target/*/release/bundle|"$ROOT"/target/release/bundle) ;;
  *) echo "Refusing unsafe Tauri bundle output: $BUNDLE_ROOT" >&2; exit 1 ;;
esac
bun "$ROOT/scripts/verify-desktop-version.mjs"
if [[ "${REQUIRE_SIGNED_MACOS:-false}" == "true" ]]; then
  if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
    echo "Signed macOS packaging requires APPLE_SIGNING_IDENTITY and an imported signing certificate." >&2
    exit 1
  fi
  if [[ -z "${APPLE_ID:-}" || -z "${APPLE_PASSWORD:-}" || -z "${APPLE_TEAM_ID:-}" ]]; then
    echo "Notarized macOS packaging requires APPLE_ID, APPLE_PASSWORD, and APPLE_TEAM_ID." >&2
    exit 1
  fi
elif [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID
  export APPLE_SIGNING_IDENTITY="-"
fi
rm -rf "$OUTPUT"
rm -rf "$BUNDLE_ROOT"
rm -f "$TARGET_ROOT/libwheeljack_ffi.dylib" \
  "$TARGET_ROOT/libwheeljack_desktop_lib.dylib"
mkdir -p "$OUTPUT"
cd "$ROOT/apps/desktop"
if [[ "${WHEELJACK_SKIP_INSTALL:-false}" != "true" ]]; then
  bun install --frozen-lockfile
fi
TAURI_ARGS=(tauri build --target "$TARGET" -- --locked)
bun "${TAURI_ARGS[@]}"
APP="$BUNDLE_ROOT/macos/wheeljack.app"
if [[ ! -d "$APP" ]]; then
  echo "Tauri app bundle was not found: $APP" >&2
  exit 1
fi
if find "$APP" -type f \( -name 'libwheeljack_ffi.dylib' -o -name 'libwheeljack_desktop_lib.dylib' \) | grep -q .; then
  echo "The Tauri app bundle contains an unused wheeljack library." >&2
  exit 1
fi
ARCHIVE="$OUTPUT/wheeljack.app.zip"
ditto -c -k --keepParent "$APP" "$ARCHIVE"
shasum -a 256 "$ARCHIVE" | awk '{ print $1 "  wheeljack.app.zip" }' > "$ARCHIVE.sha256"
DMG="$(find "$BUNDLE_ROOT" -type f -name '*.dmg' -print -quit)"
if [[ -z "$DMG" ]]; then
  echo "Tauri DMG was not found under $BUNDLE_ROOT." >&2
  exit 1
fi
cp "$DMG" "$OUTPUT/wheeljack-macos-universal.dmg"
if [[ "${WHEELJACK_NOTARIZE_DMG:-false}" == "true" ]]; then
  xcrun notarytool submit "$OUTPUT/wheeljack-macos-universal.dmg" \
    --apple-id "$APPLE_ID" \
    --password "$APPLE_PASSWORD" \
    --team-id "$APPLE_TEAM_ID" \
    --wait
  xcrun stapler staple "$OUTPUT/wheeljack-macos-universal.dmg"
  xcrun stapler validate "$OUTPUT/wheeljack-macos-universal.dmg"
fi
shasum -a 256 "$OUTPUT/wheeljack-macos-universal.dmg" |
  awk '{ print $1 "  wheeljack-macos-universal.dmg" }' > "$OUTPUT/wheeljack-macos-universal.dmg.sha256"
