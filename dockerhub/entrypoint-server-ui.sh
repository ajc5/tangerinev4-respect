#!/bin/sh
set -e

echo "Starting Tangerine Server-UI..."

# Wait for the server to be ready
echo "Waiting for Tangerine Server..."
until curl -s -o /dev/null http://server:80/; do
    sleep 2
done
echo "Tangerine Server is ready."

# Start the server-ui
cd /tangerine/server-ui
echo "Starting Tangerine Server-UI..."
npm run start:prod
