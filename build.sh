#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$SCRIPT_DIR/android"
OUT_DIR="$SCRIPT_DIR/outputs"

# Flags
FULL_CLEAN=false
RELEASE=false
WEBVIEW_DEBUG=false
BUILD_NUMBER=""
VERSION_SUFFIX=""
while [ $# -gt 0 ]; do
  case "$1" in
    --clean)             FULL_CLEAN=true ;;
    --release)           RELEASE=true ;;
    --webview-debug)     WEBVIEW_DEBUG=true ;;
    --build)             shift; BUILD_NUMBER="$1" ;;
    --build=*)           BUILD_NUMBER="${1#*=}" ;;
    --version-suffix)    shift; VERSION_SUFFIX="$1" ;;
    --version-suffix=*)  VERSION_SUFFIX="${1#*=}" ;;
    *) echo "Unknown flag: $1 (valid flags: --clean, --release, --webview-debug, --build N, --version-suffix S)" && exit 1 ;;
  esac
  shift
done

# Opt-in inspectable WebView for billing/entitlement testing on Play-signed
# release builds (capacitor.config.js reads CAP_WEBVIEW_DEBUG at cap sync).
# Play Billing only runs on the Play-signed release build, whose WebView is
# otherwise not inspectable, so entitlement state can only be reset via
# chrome://inspect on a build made with this flag.
if $WEBVIEW_DEBUG; then
  export CAP_WEBVIEW_DEBUG=1
  echo "!!=========================================================================!!"
  echo "!!  --webview-debug: WebView inspection ENABLED in this build.             !!"
  echo "!!  INTERNAL TESTING ONLY — do NOT promote this build to production.       !!"
  echo "!!  A production app with an inspectable WebView leaks sync credentials    !!"
  echo "!!  and passphrase material to anyone with a USB cable.                    !!"
  echo "!!=========================================================================!!"
fi

# Interim builds for Play's internal test track: a build number (1..999) is packed into
# the low 3 digits of the package.json-derived versionCode, keeping codes aligned with
# the marketing version (e.g. 2.3.7 build 1 -> 20307001). Plumbed to Gradle via env vars
# (see android/app/build.gradle).
if [ -n "$BUILD_NUMBER" ]; then
  if ! [[ "$BUILD_NUMBER" =~ ^[0-9]+$ ]] || [ "$BUILD_NUMBER" -gt 999 ]; then
    echo "--build must be an integer 0..999 (got: $BUILD_NUMBER)" && exit 1
  fi
  export LIFEGLANCE_BUILD_NUMBER="$BUILD_NUMBER"
  echo "==> Interim build number: $BUILD_NUMBER"
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
  #
  # Web assets are built TWICE — the two distribution channels differ on purpose:
  #   1. VITE_BUILD_CHANNEL=github → sideload APK, UNGATED (no paywall)
  #   2. VITE_BUILD_CHANNEL=play   → Play AAB, GATED (Play Billing paywall)
  # The channel is baked in at Vite build time: src/billing/billing.js builds a
  # billing adapter only for 'play' on Android, and @glance-apps/billing treats
  # a null adapter as ungated, so any other value ships an unlocked app.
  # Each pass runs cap sync, so the native capacitor.config.json is rewritten
  # per build (including the CAP_WEBVIEW_DEBUG flag) without a clean.
  #
  # The two artifacts share an applicationId, app name, icon and versionCode —
  # only the web assets and the signing key differ — so the sideload build is
  # marked in the two places a user can actually look: the file name
  # (lifeglance-github.apk, matching dayGLANCE's) and the versionName
  # (3.3.1-github). Without that, "the GitHub APK is showing me the paywall"
  # cannot be told apart from "I am running the Play build".

  # The suffix is appended to package.json's version for the sideload APK only
  # (the AAB must keep the clean x.y.z name Play expects). --version-suffix
  # still wins for interim builds: 3.3.1-rc1-github.
  GITHUB_VERSION_SUFFIX="${VERSION_SUFFIX:+$VERSION_SUFFIX-}github"

  # Artifacts this script wrote under its pre-rename names. Left in place they
  # are indistinguishable from a fresh build in outputs/ and are exactly the
  # wrong file to attach to a release, so clear them (they were overwritten on
  # every run anyway).
  for stale in lifeglance.apk lifeglance-unsigned.apk; do
    if [ -f "$OUT_DIR/$stale" ]; then
      echo "==> Removing stale $stale from a pre-rename build..."
      rm -f "$OUT_DIR/$stale"
    fi
  done

  echo "==> Building web assets (channel: github, ungated)..."
  cd "$SCRIPT_DIR"
  VITE_BUILD_CHANNEL=github npm run build:mobile

  echo "==> Building sideload APK (ungated, versionName suffix: -$GITHUB_VERSION_SUFFIX)..."
  cd "$ANDROID_DIR"
  ./gradlew assembleRelease -PversionNameSuffix="$GITHUB_VERSION_SUFFIX"

  # assembleRelease emits app-release-unsigned.apk until signing is configured,
  # and app-release.apk once it is — copy whichever exists.
  APK_REL_DIR="app/build/outputs/apk/release"
  if [ -f "$APK_REL_DIR/app-release.apk" ]; then
    APK_OUT="lifeglance-github.apk"
    cp "$APK_REL_DIR/app-release.apk" "$OUT_DIR/$APK_OUT"
    echo "    APK → outputs/$APK_OUT (signed)"
  else
    APK_OUT="lifeglance-github-unsigned.apk"
    cp "$APK_REL_DIR/app-release-unsigned.apk" "$OUT_DIR/$APK_OUT"
    echo "    APK → outputs/$APK_OUT (UNSIGNED — configure signing to publish)"
  fi

  # Second web build produces a new content-hashed bundle; wipe the stale
  # asset intermediates again (same failure mode as the top-of-script wipe).
  rm -rf "$ANDROID_DIR/app/build/intermediates/compressed_assets"

  echo "==> Building web assets (channel: play, gated)..."
  cd "$SCRIPT_DIR"
  VITE_BUILD_CHANNEL=play npm run build:mobile

  echo "==> Building Play AAB (gated)..."
  cd "$ANDROID_DIR"
  ./gradlew bundleRelease

  cp "app/build/outputs/bundle/release/app-release.aab" "$OUT_DIR/lifeglance.aab"
  echo "    AAB → outputs/lifeglance.aab"

  # Print the APK's signing certificate. The published fingerprint is in
  # README.md ("Verifying the APK"); a mismatch means the artifact was not
  # produced by this keystore. Also catches a missing/misconfigured
  # key.properties that would otherwise ship an unsigned APK.
  SDK_DIR="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"
  APKSIGNER="$(command -v apksigner || true)"
  if [ -z "$APKSIGNER" ] && [ -n "$SDK_DIR" ]; then
    APKSIGNER="$(ls "$SDK_DIR"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -1)"
  fi
  if [ "$APK_OUT" = "lifeglance-github-unsigned.apk" ]; then
    echo "    (APK is unsigned; skipping signature check)"
  elif [ -n "$APKSIGNER" ]; then
    # No `|| true`: set -e is on, so a bad signature stops the release here
    # rather than at the point someone tries to install the APK.
    echo "==> Verifying APK signature..."
    "$APKSIGNER" verify --print-certs "$OUT_DIR/$APK_OUT"
  else
    echo "    (apksigner not found on PATH or in \$ANDROID_HOME; skipping signature check)"
  fi

  # SHA-256 checksums for the release artifacts, written with bare filenames so
  # `sha256sum -c SHA256SUMS.txt` works wherever they are downloaded to. Publish
  # it alongside the APK on the GitHub release: it is the user-side proof that
  # the APK they installed is this build and not a repack from a mirror site
  # (mirrors redistribute the GATED Play build under the same name and version).
  echo "==> Writing SHA-256 checksums..."
  (
    cd "$OUT_DIR"
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum "$APK_OUT" lifeglance.aab > SHA256SUMS.txt
    else
      shasum -a 256 "$APK_OUT" lifeglance.aab > SHA256SUMS.txt
    fi
    sed 's/^/    /' SHA256SUMS.txt
  )

  echo ""
  echo "==> Android release build complete. outputs/:"
  ls -lh "$OUT_DIR"
  if $WEBVIEW_DEBUG; then
    echo ""
    echo "!!  Reminder: these builds have an INSPECTABLE WebView (--webview-debug)."
    echo "!!  Internal testing only — do NOT promote to production."
  fi

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
