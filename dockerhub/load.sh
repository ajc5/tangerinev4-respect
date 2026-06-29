#!/bin/sh
set -e

echo "============================================"
echo "  Tangerine Docker Image Importer"
echo "============================================"

VERSION="${1:-latest}"
SRC_DIR="${2:-./tangerine-images}"
IMAGE_PREFIX="${3:-tangerine}"

if [ ! -d "$SRC_DIR" ]; then
  echo "Error: Directory '$SRC_DIR' not found."
  echo "Usage: ./load.sh [version] [directory] [prefix]"
  echo "  Default version: latest"
  echo "  Default directory: ./tangerine-images"
  echo "  Default prefix: tangerine"
  exit 1
fi

IMAGES="couchdb server server-ui apk-generator"

for name in $IMAGES; do
  FILE="$SRC_DIR/tangerine-$name.tar.gz"
  if [ -f "$FILE" ]; then
    echo "Loading $IMAGE_PREFIX/tangerine-$name:$VERSION ..."
    gunzip -c "$FILE" | docker load
  else
    echo "Warning: $FILE not found, skipping."
  fi
done

echo ""
echo "============================================"
echo "  All images loaded!"
echo "  Run: docker compose up -d"
echo "============================================"
