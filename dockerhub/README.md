# Tangerine — Docker Images

This directory contains everything needed to build and publish Tangerine Docker images to Docker Hub, and deploy them on any VM with Docker.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    nginx (port 80)                    │
│  Routes / -> server-ui, /api/* -> server,             │
│  /apk-generator -> apk-generator                      │
└────┬──────────┬──────────────┬──────────┬────────────┘
     │          │              │          │
┌────▼───┐ ┌───▼──────┐ ┌─────▼────┐ ┌───▼──────────┐
│ CouchDB│ │  Server  │ │Server-UI │ │APK Generator  │
│ :5984  │ │  :80     │ │ :80      │ │ :80           │
└────────┘ └──────────┘ └──────────┘ └───────────────┘
```

## Images

| Image | Description | Based On |
|---|---|---|
| `tangerine/couchdb` | CouchDB 3 database | `couchdb:3` |
| `tangerine/server` | Tangerine API server + built client app | `node:18-alpine` |
| `tangerine/server-ui` | Tangerine admin UI (Editor) | `node:18-alpine` |
| `tangerine/apk-generator` | APK/PWA release builder | `alvrme/alpine-android:android-32-jdk11` |

---

## 🚀 Deploy (for people using your published images)

Once the images are on Docker Hub, anyone can deploy in **3 steps**:

### 1. Copy these 3 files to your VM

```
docker-compose.yml
.env
nginx/default.conf
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env — change at minimum:
#   T_USER1_PASSWORD    (super admin password)
#   T_UPLOAD_TOKEN       (tablet sync password)
#   T_COUCHDB_USER_ADMIN_PASS (database admin password)
#   T_HOST_NAME          (your domain or VM IP)
#   T_PROTOCOL           (http or https)
```

### 3. Run

```bash
docker compose up -d
```

That's it — no source code, no build, no waiting. Tangerine will be available at `http://<your-vm-ip>`.

### Managing

```bash
# View logs
docker compose logs -f
# Stop (data preserved in volumes)
docker compose down
# Full cleanup (deletes all data)
docker compose down -v
```

---

## 🔨 Build & Publish (for you — run on your fast local machine)

### Prerequisites

- Docker installed locally
- Docker Hub account — sign up at [hub.docker.com](https://hub.docker.com)
- Logged in via `docker login`

### One-command: build all images + push to Docker Hub

```bash
cd dockerhub
./build.sh --push v4.2.0
```

That builds all 4 images and pushes them to `tangerine/couchdb`, `tangerine/server`, etc. on Docker Hub.

### Build only (no push)

```bash
./build.sh v4.2.0
```

### Alternative: save & load (no registry needed)

If you don't want a registry, build on your fast machine, then ship the images directly to your VM:

```bash
# On your fast machine — build + save
cd dockerhub
./build.sh v4.2.0
./save.sh v4.2.0

# Copy the tangerine-images/ folder to your VM via SCP/rsync

# On your VM — load + run
./load.sh v4.2.0
docker compose up -d
```

### Build individual images

```bash
# From the project root
docker build -f dockerhub/Dockerfile.server -t tangerine/server:v4.2.0 .
docker push tangerine/server:v4.2.0

docker build -f dockerhub/Dockerfile.server-ui -t tangerine/server-ui:v4.2.0 .
docker push tangerine/server-ui:v4.2.0

docker build -f dockerhub/Dockerfile.apk-generator -t tangerine/apk-generator:v4.2.0 .
docker push tangerine/apk-generator:v4.2.0

docker build -f dockerhub/Dockerfile.couchdb -t tangerine/couchdb:v4.2.0 .
docker push tangerine/couchdb:v4.2.0
```

### Multi-architecture builds (AMD64 + ARM64)

```bash
docker buildx create --name mybuilder --use
docker buildx inspect --bootstrap

docker buildx build \
  -f dockerhub/Dockerfile.server \
  -t tangerine/server:v4.2.0 \
  -t tangerine/server:latest \
  --platform linux/amd64,linux/arm64 \
  --push \
  .
```

---

## Environment Variables

See `.env.example` for the full list.

### Required

| Variable | Description | Default |
|---|---|---|
| `T_HOST_NAME` | Domain name of your Tangerine instance | `localhost` |
| `T_PROTOCOL` | `http` or `https` | `http` |
| `T_USER1` | Super admin username | `user1` |
| `T_USER1_PASSWORD` | Super admin password | `password` |
| `T_UPLOAD_TOKEN` | Tablet upload auth token | `password` |
| `T_COUCHDB_USER_ADMIN_NAME` | CouchDB admin username | `admin` |
| `T_COUCHDB_USER_ADMIN_PASS` | CouchDB admin password | `password` |
| `T_MODULES` | Enabled modules | `['csv']` |

### Common Optional

| Variable | Description | Default |
|---|---|---|
| `T_REPORTING_DELAY` | Reporting processing delay (ms) | `300000` |
| `T_PAID_MODE` | `site` or `group` | `site` |
| `T_PAID_ALLOWANCE` | Upload allowance | `unlimited` |
| `T_CSV_BATCH_SIZE` | CSV generation batch size | `50` |
| `T_PORT_MAPPING` | Host port mapping | `80:80` |

---

## Data Persistence

Data is stored in Docker volumes:

| Volume | Content |
|---|---|
| `couchdb-data` | CouchDB database files |
| `tangerine-data` | Application data (releases, uploads) |
| `csv-data` | CSV output files |
| `archives-data` | Archived releases |
| `state-data` | Worker state files |

To back up, use:
```bash
docker run --rm -v couchdb-data:/data -v $(pwd):/backup alpine tar czf /backup/couchdb-backup.tar.gz -C /data .
```

---

## File Structure

```
dockerhub/
├── README.md                         # This file
├── build.sh                          # Build & push all images
├── .env.example                      # Environment variable reference
├── docker-compose.yml                # Production Compose file
├── Dockerfile.couchdb                # CouchDB image
├── Dockerfile.server                 # Server image
├── Dockerfile.server-ui              # Server-UI image
├── Dockerfile.apk-generator          # APK Generator image
├── entrypoint-server.sh              # Server container entrypoint
├── entrypoint-server-ui.sh           # Server-UI container entrypoint
└── nginx/
    └── default.conf                  # Nginx reverse proxy config
```
