#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$SCRIPT_DIR/android"
OUT_DIR="$SCRIPT_DIR/outputs"

# Flags
FULL_CLEAN=false
RELEASE=false
VERSION_CODE=""
VERSION_SUFFIX=""
while [ $# -gt 0 ]; do
  case "$1" in
    --clean)             FULL_CLEAN=true ;;
    --release)           RELEASE=true ;;
    --version-code)      shift; VERSION_CODE="$1" ;;
    --version-code=*)    VERSION_CODE="${1#*=}" ;;
    --version-suffix)    shift; VERSION_SUFFIX="$1" ;;
    --version-suffix=*)  VERSION_SUFFIX="${1#*=}" ;;
    *) echo "Unknown flag: $1 (valid flags: --clean, --release, --version-code N, --version-suffix S)" && exit 1 ;;
  esac
  shift
done

# Interim builds for Play's internal test track: pass an explicit, strictly increasing
# versionCode without bumping package.json. Plumbed to Gradle via env vars (see
# android/app/build.gradle).
if [ -n "$VERSION_CODE" ]; then
  if ! [[ "$VERSION_CODE" =~ ^[0-9]+$ ]]; then
    echo "--version-code must be a positive integer (got: $VERSION_CODE)" && exit 1
  fi
  export LIFEGLANCE_VERSION_CODE="$VERSION_CODE"
  echo "==> Using interim versionCode: $VERSION_CODE"
fi
if [ -n "$VERSION_SUFFIX" ]; then
  export LIFEGLANCE_VERSION_SUFFIX="$VERSION_SUFFIX"
  echo "==> Using versionName suffix: -$VERSION_SUFFIX"
fi

# ── Dependencies ────────────────────────────────────────────────────────────
echo "==> Installing npm dependencies..."
cd "$SCRIPT_DIR"
npm install

# ── Clean ──────────────────────────────────────────────────────────────────
if $FULL_CLEAN; then
  echo "==> Full clean..."
  cd "$ANDROID_DIR" && ./gradlew clean
  cd "$SCRIPT_DIR"
  rm -rf dist
else
  # Vite produces a new content-hashed bundle on every build, so Gradle's
  # incremental asset pipeline accumulates stale .jar files for the old
  # hashes and then fails with "already contains entry". Wipe just that
  # intermediates directory — it is cheap and rebuilt every assembleDebug.
  STALE_ASSETS="$ANDROID_DIR/app/build/intermediates/compressed_assets"
  if [ -d "$STALE_ASSETS" ]; then
    echo "==> Clearing stale asset intermediates..."
    rm -rf "$STALE_ASSETS"
  fi
fi

mkdir -p "$OUT_DIR"

if $RELEASE; then
  # ── Android release ────────────────────────────────────────────────────
  # Release builds are signed when android/key.properties is present (see
  # android/key.properties.example); without it they fall back to UNSIGNED.
  echo "==> Building web assets..."
  cd "$SCRIPT_DIR"
  npm run build:mobile

  echo "==> Building release APK + AAB..."
  cd "$ANDROID_DIR"
  ./gradlew assembleRelease bundleRelease

  # assembleRelease emits app-release-unsigned.apk until signing is configured,
  # and app-release.apk once it is — copy whichever exists.
  APK_REL_DIR="app/build/outputs/apk/release"
  if [ -f "$APK_REL_DIR/app-release.apk" ]; then
    cp "$APK_REL_DIR/app-release.apk" "$OUT_DIR/lifeglance.apk"
    echo "    APK → outputs/lifeglance.apk (signed)"
  else
    cp "$APK_REL_DIR/app-release-unsigned.apk" "$OUT_DIR/lifeglance-unsigned.apk"
    echo "    APK → outputs/lifeglance-unsigned.apk (UNSIGNED — configure signing to publish)"
  fi

  cp "app/build/outputs/bundle/release/app-release.aab" "$OUT_DIR/lifeglance.aab"
  echo "    AAB → outputs/lifeglance.aab"

  echo ""
  echo "==> Android release build complete. outputs/:"
  ls -lh "$OUT_DIR"

else
  # ── Debug APK + install ────────────────────────────────────────────────
  echo "==> Building web assets..."
  cd "$SCRIPT_DIR"
  npm run build:mobile

  APK_SRC="$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk"
  APK_DEST="$OUT_DIR/lifeglance-debug.apk"

  echo "==> Building debug APK..."
  cd "$ANDROID_DIR"
  ./gradlew assembleDebug

  cp "$APK_SRC" "$APK_DEST"
  echo "==> Installing on connected device..."
  adb install -r "$APK_DEST"
  echo "==> Done! App installed."
fi
