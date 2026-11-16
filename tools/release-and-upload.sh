#!/usr/bin/env bash
# release-and-upload.sh - Build release and upload to Chrome Web Store
# Usage: ./tools/release-and-upload.sh [version] [--publish] [--target default|trustedTesters]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

VERSION="${1:-}"
PUBLISH=false
TARGET="default"

# Parse arguments
shift || true
while [[ $# -gt 0 ]]; do
    case $1 in
        --publish) PUBLISH=true ;;
        --target) TARGET="$2"; shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
    shift
done

# Get version from manifest if not provided
if [[ -z "$VERSION" ]]; then
    VERSION=$(python3 -c "import json; print(json.load(open('extension/manifest.json'))['version'])")
fi

echo "Building release for version $VERSION..."
python3 tools/release.py --output-dir "releases/v$VERSION"

ZIP_PATH="releases/v$VERSION/notable-reader-extension-$VERSION.zip"
if [[ ! -f "$ZIP_PATH" ]]; then
    echo "ERROR: ZIP not found at $ZIP_PATH"
    exit 1
fi

echo "Uploading to Chrome Web Store..."
UPLOAD_ARGS=("--zip-path" "$ZIP_PATH")
if [[ "$PUBLISH" == "true" ]]; then
    UPLOAD_ARGS+=("--publish" "--target" "$TARGET")
fi

python3 tools/upload-cws.py "${UPLOAD_ARGS[@]}"

echo "Done!"