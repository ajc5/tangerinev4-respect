#!/bin/sh
set -e

echo "============================================"
echo "  Tangerine Docker Image Exporter"
echo "============================================"

VERSION="${1:-latest}"
OUT_DIR="${2:-./tangerine-images}"
IMAGE_PREFIX="${3:-tangerine}"

mkdir -p "$OUT_DIR"

IMAGES="couchdb server server-ui apk-generator"

for name in $IMAGES; do
  echo "Saving $IMAGE_PREFIX/tangerine-$name:$VERSION ..."
  docker save "$IMAGE_PREFIX/tangerine-$name:$VERSION" | gzip > "$OUT_DIR/tangerine-$name.tar.gz"
done

echo ""
echo "============================================"
echo "  All images saved to: $OUT_DIR/"
echo "============================================"
echo ""
echo "Copy the folder to your VM, then run:"
echo "  ./load.sh $VERSION $OUT_DIR $IMAGE_PREFIX"
ls -lh "$OUT_DIR/"
