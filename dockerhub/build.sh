#!/bin/sh
set -e

echo "============================================"
echo "  Tangerine Docker Image Builder"
echo "============================================"

# Docker Hub username — defaults to your logged-in user
if [ -z "$DOCKER_USER" ]; then
  DOCKER_USER=$(docker info 2>/dev/null | grep Username | awk '{print $2}')
  if [ -z "$DOCKER_USER" ]; then
    echo "ERROR: Not logged into Docker Hub."
    echo "  Run: docker login"
    echo "  Or set: DOCKER_USER=yourusername ./build.sh --push v4.2.0"
    exit 1
  fi
fi

# Parse --push flag
DO_PUSH=false
if [ "$1" = "--push" ]; then
  DO_PUSH=true
  shift
fi

# Determine version from git tag or argument
if [ -n "$1" ]; then
  VERSION="$1"
elif [ -n "$T_TAG" ]; then
  VERSION="$T_TAG"
else
  VERSION=$(git describe --tags --abbrev=0 2>/dev/null || echo "latest")
fi

echo "Building Tangerine version: $VERSION"
echo "Publishing as: $DOCKER_USER/tangerine-*"
echo "Target platform: linux/amd64 (for GCP/AWS/Azure VMs)"
echo ""

# Ensure buildx is available
docker buildx inspect 2>/dev/null || docker buildx create --use
PLATFORM="linux/amd64"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

build_image() {
  local name="$1"
  local dockerfile="$2"
  local context="$3"

  echo "--------------------------------------------"
  echo "  Building: $DOCKER_USER/tangerine-$name:$VERSION"
  echo "  Platform: $PLATFORM"
  echo "--------------------------------------------"

  if [ "$DO_PUSH" = true ]; then
    docker buildx build \
      -f "$dockerfile" \
      -t "$DOCKER_USER/tangerine-$name:$VERSION" \
      -t "$DOCKER_USER/tangerine-$name:latest" \
      --platform "$PLATFORM" \
      --push \
      "$context"
  else
    docker buildx build \
      -f "$dockerfile" \
      -t "$DOCKER_USER/tangerine-$name:$VERSION" \
      -t "$DOCKER_USER/tangerine-$name:latest" \
      --platform "$PLATFORM" \
      --load \
      "$context"
  fi

  echo ""
}

# Build each image
build_image "couchdb" "$SCRIPT_DIR/Dockerfile.couchdb" "$PROJECT_DIR"
build_image "server" "$SCRIPT_DIR/Dockerfile.server" "$PROJECT_DIR"
build_image "server-ui" "$SCRIPT_DIR/Dockerfile.server-ui" "$PROJECT_DIR"
build_image "apk-generator" "$SCRIPT_DIR/Dockerfile.apk-generator" "$PROJECT_DIR"

echo "============================================"
if [ "$DO_PUSH" = true ]; then
  echo "  All images pushed to Docker Hub!"
  echo "  $DOCKER_USER/tangerine-{couchdb,server,server-ui,apk-generator}:$VERSION"
  echo ""
  echo "  For others to deploy:"
  echo "  1. Copy docker-compose.yml, .env, nginx/ to their VM"
  echo "  2. Set IMAGE_PREFIX=$DOCKER_USER in .env"
  echo "  3. docker compose up -d"
else
  echo "  All images built successfully!"
  echo "  To also push: ./build.sh --push $VERSION"
fi
echo "============================================"
