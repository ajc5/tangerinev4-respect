#!/bin/sh
set -e

echo "Starting Tangerine Server..."

# Ensure required directories exist
mkdir -p /csv /archives /state
mkdir -p /tangerine/client/releases/prod/apks
mkdir -p /tangerine/client/releases/prod/pwas
mkdir -p /tangerine/client/releases/prod/dat
mkdir -p /tangerine/client/releases/qa/apks
mkdir -p /tangerine/client/releases/qa/pwas
mkdir -p /tangerine/client/releases/qa/dat

# Initialize state files if they don't exist
[ ! -f /state/reporting-worker-state.json ] && echo '{}' > /state/reporting-worker-state.json
[ ! -f /state/paid-worker-state.json ] && echo '{}' > /state/paid-worker-state.json

# Set up SSH keys if not provided
if [ ! -f /root/.ssh/id_rsa ]; then
    mkdir -p /root/.ssh
    echo '' > /root/.ssh/id_rsa
    echo '' > /root/.ssh/id_rsa.pub
fi

# Wait for CouchDB to be ready
echo "Waiting for CouchDB at $T_COUCHDB_ENDPOINT..."
until curl -sf "$T_COUCHDB_ENDPOINT" > /dev/null 2>&1; do
    sleep 2
done
echo "CouchDB is ready."

# Run first-time initialization if needed
if [ ! -f /state/.server-initialized ]; then
    echo "First run — running initialization..."
    cd /tangerine/server
    node src/scripts/enable-module.js csv 2>/dev/null || true
    touch /state/.server-initialized
fi

# Start the server
cd /tangerine/server
echo "Starting Tangerine Server..."
npm run start:prod
