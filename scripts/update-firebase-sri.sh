#!/usr/bin/env bash
# Bump the Firebase JS SDK version + recompute the SRI integrity hashes
# baked into docs/Third_session/PBL_platform/index.html. Dependabot
# can't see CDN-loaded scripts, so this is the manual operator path —
# it's a 30-second job once you have a target version.
#
# Usage:
#   bash scripts/update-firebase-sri.sh 10.13.2
#
# What it does (in order):
#   1. Verifies https://www.gstatic.com/firebasejs/<VERSION>/ exists.
#   2. Downloads each of the four compat SDKs we ship (app, database,
#      auth, app-check, performance) and computes sha384-<base64>.
#   3. Rewrites the four <script ... integrity="..."> lines in
#      docs/Third_session/PBL_platform/index.html with the new version
#      + new hashes.
#   4. Prints a `git diff --stat` so you can sanity-check.
#
# Then: open a PR. CI will catch a broken hash because the platform
# fails to load (the E2E suite asserts no console errors during page
# load, which catches integrity-mismatch errors).
#
# Reference for current version:
#   https://firebase.google.com/support/release-notes/js

set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Usage: $0 <firebase-sdk-version>   e.g. 10.13.2"
  echo ""
  echo "Latest releases: https://firebase.google.com/support/release-notes/js"
  exit 2
fi

# Validate version shape (10.x.y) to avoid path-traversal mishaps when
# the script is reused in CI / a Cloud Function.
if ! printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "Refusing — version must be semver MAJOR.MINOR.PATCH (got: $VERSION)"
  exit 2
fi

INDEX_HTML="$(dirname "$0")/../docs/Third_session/PBL_platform/index.html"
if [ ! -f "$INDEX_HTML" ]; then
  echo "Could not find index.html at $INDEX_HTML"
  exit 2
fi

BASE_URL="https://www.gstatic.com/firebasejs/$VERSION"

# Probe the directory listing first so a typo doesn't waste five downloads
if ! curl -fsSL --head "$BASE_URL/firebase-app-compat.js" > /dev/null; then
  echo "Firebase SDK $VERSION not found on gstatic (curled $BASE_URL/firebase-app-compat.js)."
  echo "Check the release notes link above; bumps usually appear within a few hours."
  exit 1
fi

# Files in load order — must match the order in index.html so the
# sed-rewrite-by-line-number trick below stays robust.
declare -a FILES=(
  "firebase-app-compat.js"
  "firebase-database-compat.js"
  "firebase-auth-compat.js"
  "firebase-app-check-compat.js"
  "firebase-performance-compat.js"
)

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

echo "--- Firebase SDK SRI update ---"
echo "Version:    $VERSION"
echo "Target:     $INDEX_HTML"
echo ""

# Compute new hashes
declare -a HASHES=()
for f in "${FILES[@]}"; do
  echo "  -> downloading $f"
  curl -fsSL "$BASE_URL/$f" -o "$TMPDIR/$f"
  H="sha384-$(openssl dgst -sha384 -binary "$TMPDIR/$f" | openssl base64 -A)"
  echo "     $H"
  HASHES+=("$H")
done
echo ""

# Update version + integrity hashes in index.html.
# We anchor each replace on the URL prefix (which embeds the version),
# so the rewrite is robust to the integrity attribute being on a
# different line / having different whitespace.
echo "Rewriting integrity attributes in index.html…"
for i in "${!FILES[@]}"; do
  f="${FILES[$i]}"
  h="${HASHES[$i]}"
  # Step 1: bump the version in the script src for THIS file.
  perl -i -pe 's{firebasejs/[0-9]+\.[0-9]+\.[0-9]+/'"$f"'}{firebasejs/'"$VERSION"'/'"$f"'}g' "$INDEX_HTML"
  # Step 2: in the BLOCK starting at this script's src and ending at
  # the next </script>, replace the integrity= attribute value.
  perl -i -0pe '
    s{(firebasejs/'"$VERSION"'/'"$f"'.{0,500}?integrity=")[^"]*(")}
     {${1}'"$h"'${2}}s
  ' "$INDEX_HTML"
done

echo ""
echo "--- git diff --stat ---"
git -C "$(dirname "$0")/.." diff --stat -- "docs/Third_session/PBL_platform/index.html" || true
echo ""
echo "Done. Verify with:  git -C . diff docs/Third_session/PBL_platform/index.html"
echo "Then open a PR. The E2E suite will catch integrity mismatches at page-load."
