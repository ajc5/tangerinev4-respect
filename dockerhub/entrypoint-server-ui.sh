#!/bin/sh
set -e

echo "Starting Tangerine Server-UI..."

# Wait for the server to be ready
echo "Waiting for Tangerine Server..."
until curl -sf http://server:80/login > /dev/null 2>&1; do
    sleep 2
done
echo "Tangerine Server is ready."

# Start the server-ui
cd /tangerine/server-ui
echo "Starting Tangerine Server-UI..."
npm run start:prod
