# BUG SNIPER - Production Deployment & Hardening Guide

This document describes the complete, authoritative procedure for deploying **BUG SNIPER** in production for high-stakes college technical symposiums.

---

## 1. Architecture & Security Model

```text
                      INTERNET
                         │
                 Ports 80 / 443 (HTTPS)
                         │
                         ▼
        ┌──────────────────────────────────┐
        │       Nginx Reverse Proxy        │  (TLS termination, HTTP->HTTPS redirect,
        │       (Port 80 / 443)            │   SSE buffering disabled, Host forwarding)
        └────────────────┬─────────────────┘
                         │ Proxy to localhost:3000
                         ▼
        ┌──────────────────────────────────┐
        │   BUG SNIPER Node Application    │  User: bugsniper (NON-ROOT)
        │   (Express + dist/server.cjs)    │  Port: 127.0.0.1:3000 (NOT public)
        └────────┬────────────────┬────────┘
                 │                │
     Redis Queue │                │ External PostgreSQL
     (BullMQ)    │                │ (127.0.0.1:5432)
                 ▼                ▼
        ┌────────────────┐ ┌────────────────┐
        │ Redis 7 Server │ │ PostgreSQL 16  │
        │ 127.0.0.1:6379 │ │ 127.0.0.1:5432 │
        └────────────────┘ └────────────────┘
                 │
                 ▼ Job Dispatch
        ┌──────────────────────────────────┐
        │    Java Sandbox Worker Daemon    │
        │    (unshare -n -p -f + setpriv)  │  Runs unprivileged as sandbox user (UID 1001)
        └──────────────────────────────────┘
```

---

## 2. Dedicated Non-Root System Accounts

The Node.js server and background workers **must NEVER run as root**. The public web process and the background worker process are separated into distinct service accounts with minimal required privileges.

### A. Dedicated Web Service Account (`bugsniper`)
```bash
# System user for running the public Express/React web tier
# HAS ZERO LINUX CAPABILITIES (NO CAP_SYS_ADMIN, NO CAP_SETUID, NO CAP_SETGID)
sudo useradd -r -s /usr/sbin/nologin -d /opt/bugsniper bugsniper
```

### B. Dedicated Worker Service Account (`bugsniper-worker`)
```bash
# System user for running the execution worker daemon
# Granted only the specific ambient capabilities required for unshare/setpriv
sudo useradd -r -s /usr/sbin/nologin -d /opt/bugsniper bugsniper-worker
```

### C. Isolated Sandbox Execution Account (`sandbox` - UID 1001)
```bash
# Unprivileged sandbox user for compiling and executing participant Java submissions
sudo useradd -u 1001 -U -m -s /bin/bash sandbox
```

### D. Sandbox Workspace Directory Permissions
```bash
# Create the ephemeral sandbox base directory
sudo mkdir -p /tmp/sandboxes
sudo chmod 1777 /tmp/sandboxes
```
`mode 1777` (sticky bit) allows the `bugsniper-worker` service account and the `sandbox` (UID 1001) execution user to read, write, and clean up ephemeral job workspaces without permission collisions. The public web process (`bugsniper`) does not interact with this directory.

---

## 3. Host Dependencies & Linux Sandbox Primitives

Install OpenJDK 21 LTS, Redis, PostgreSQL, and Linux namespace isolation tools:

```bash
sudo apt-get update
sudo apt-get install -y \
  openjdk-21-jdk-headless \
  util-linux \
  postgresql postgresql-contrib \
  redis-server \
  nginx certbot python3-certbot-nginx \
  ufw
```

### Sandbox Preflight Checklist
The system validates these 7 primitives at startup in production. If any primitive is missing, startup fails immediately:
1. `java` binary available (`/usr/bin/java`)
2. `javac` binary available (`/usr/bin/javac`)
3. OpenJDK 21 LTS verified (`javac -version` major version 21)
4. `unshare` binary available (`/usr/bin/unshare` for network namespace isolation)
5. `setpriv` binary available (`/usr/bin/setpriv` for privilege dropping to UID 1001)
6. Sandbox user exists (`id -u sandbox` returns `1001`)
7. `/tmp/sandboxes` exists and has safe permissions (`1777`)

---

## 4. Firewall & Network Exposure

Only ports **80 (HTTP)**, **443 (HTTPS)**, and **SSH (22)** may be exposed publicly.
Internal services (**Node: 3000**, **PostgreSQL: 5432**, **Redis: 6379**) must bind strictly to `127.0.0.1` and be inaccessible from WAN/LAN:

```bash
# Configure UFW
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### Localhost Binding Verification
- PostgreSQL (`/etc/postgresql/16/main/postgresql.conf`): `listen_addresses = 'localhost'`
- Redis (`/etc/redis/redis.conf`): `bind 127.0.0.1 ::1`

---

## 5. Application Build & Clean Deployment
 
BUG SNIPER is built with `vite` and `esbuild`, producing two standalone CommonJS bundles:
- `dist/server.cjs`: Public Express API server and client frontend
- `dist/worker.cjs`: Standalone Java execution worker daemon

### Step-by-Step Installation Procedure:
```bash
# 1. Clone repository to /opt/bugsniper
sudo git clone https://github.com/projectfinalyear3027-creator/bug-rip.git /opt/bugsniper
cd /opt/bugsniper

# 2. Install all dependencies strictly from package-lock.json
sudo npm ci

# 3. Compile client SPA assets, web server bundle, and worker daemon bundle
sudo npm run build

# 4. Optional: Prune build tools from production deployment
# (Node runs dist/server.cjs and dist/worker.cjs; tsx is NOT needed at runtime)
sudo npm prune --production

# 5. Set correct directory ownership and permissions
sudo chown -R bugsniper:bugsniper /opt/bugsniper
# Allow bugsniper-worker read access to application bundles
sudo usermod -a -G bugsniper bugsniper-worker
sudo chmod -R g+rX /opt/bugsniper/dist
sudo mkdir -p /var/log/bugsniper
sudo chown -R bugsniper:bugsniper /var/log/bugsniper
sudo chmod 775 /var/log/bugsniper
```

---

## 6. Production Environment Configuration

Create `/etc/bugsniper/bugsniper.env` with restricted permissions (`chmod 640`, group `bugsniper`):

```bash
sudo mkdir -p /etc/bugsniper
sudo nano /etc/bugsniper/bugsniper.env
```

```ini
# Runtime Environment
NODE_ENV=production
PORT=3000

# PostgreSQL Connection (Mandatory in production - no silent PGlite fallback)
DATABASE_URL=postgresql://bugrip_user:YOUR_STRONG_DB_PASSWORD@127.0.0.1:5432/bugrip_db

# Redis Connection (Mandatory in production - no in-memory queue fallback)
REDIS_URL=redis://127.0.0.1:6379
EXECUTION_QUEUE_NAME=java-execution

# Admin Security Keys (MANDATORY in production - must be >= 16 characters)
ADMIN_SECRET_KEY=YOUR_CRYPTOGRAPHICALLY_RANDOM_SECRET_KEY_MIN_16_CHARS

# Initial Super Admin Password (Required on fresh database setup - must be >= 10 characters)
ADMIN_INITIAL_PASSWORD=YOUR_STRONG_ADMIN_INITIAL_PASSWORD

# Public URL and CORS Configuration (Strictly limits accepted cross-origin requests)
APP_URL=https://bugsniper.yourdomain.com
CORS_ORIGIN=https://bugsniper.yourdomain.com

# Competition Format (SOLO individual competition)
COMPETITION_DURATION_MINUTES=60
MIN_TEAM_MEMBERS=1
MAX_TEAM_MEMBERS=1
```

Set secure permissions:
```bash
sudo chown bugsniper:bugsniper /etc/bugsniper/bugsniper.env
sudo chmod 640 /etc/bugsniper/bugsniper.env
```

---

## 7. Systemd Service Configuration (Split Web & Worker Architecture)

Install both dedicated service units from the repository:

### A. Install and Start the Web Tier Service
`bugsniper-web.service` runs the Express application under user `bugsniper` with **zero Linux capabilities**:
```bash
sudo cp production/bugsniper-web.service /etc/systemd/system/bugsniper-web.service
sudo systemctl daemon-reload
sudo systemctl enable bugsniper-web
sudo systemctl start bugsniper-web
```

### B. Install and Start the Worker Tier Service
`bugsniper-worker.service` runs the standalone worker daemon under user `bugsniper-worker` with **ambient capabilities** strictly scoped to Linux namespace isolation and setpriv unprivileged execution:
```bash
sudo cp production/bugsniper-worker.service /etc/systemd/system/bugsniper-worker.service
sudo systemctl daemon-reload
sudo systemctl enable bugsniper-worker
sudo systemctl start bugsniper-worker
```

Check status and logs of both services:
```bash
sudo systemctl status bugsniper-web
sudo systemctl status bugsniper-worker
sudo journalctl -u bugsniper-web -f
sudo journalctl -u bugsniper-worker -f
```

---

## 8. Nginx HTTPS & Reverse Proxy Setup

Copy `/production/nginx.conf` to `/etc/nginx/sites-available/bugsniper.conf`:

```bash
sudo cp production/nginx.conf /etc/nginx/sites-available/bugsniper.conf
sudo ln -s /etc/nginx/sites-available/bugsniper.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Obtain Let's Encrypt TLS certificate:
```bash
sudo certbot --nginx -d bugsniper.yourdomain.com
```

Key Nginx Directives Configured:
- `proxy_buffering off;` (Essential for real-time SSE execution logs and timer events)
- `proxy_read_timeout 86400s;` (Keeps long-lived SSE connections open)
- `X-Forwarded-Proto https` (Ensures Express `trust proxy` detects HTTPS and enables `Secure` cookies)

---

## 9. Verification & Health Probes

### A. Readiness Probe
Verify that the service, database, migrations, seeds, Redis, and Java worker are fully operational:

```bash
curl -i http://127.0.0.1:3000/ready
# or through HTTPS
curl -i https://bugsniper.yourdomain.com/ready
```

Expected Output (HTTP 200 OK):
```json
{
  "ready": true,
  "status": "ready",
  "services": {
    "api": "healthy",
    "database": "healthy",
    "java": "ready",
    "queue": "ready",
    "worker": "ready"
  },
  "details": {
    "databaseEngine": "PostgreSQL (Network Pool)",
    "databaseMode": "EXTERNAL_POSTGRES",
    "queueMode": "redis",
    "javaVersion": "openjdk version \"21.0.x\"",
    "isJdk21": true
  }
}
```

If Java compiler, Redis, or PostgreSQL fails, the endpoint returns **HTTP 503** with `status: "degraded"` or `"failed"` and details on the offline component.

---

## 10. Solo Event Verification Checklist

- [x] `minTeamMembers = 1` and `maxTeamMembers = 1` enforced in authoritative database.
- [x] Solo participant authentication via Participant Access Code from imported CSV.
- [x] Zero demo participants created on startup.
- [x] Exactly 45 canonical challenges (15 Easy, 10 Medium, 10 Hard, 10 Extreme).
- [x] Solve unlocks: 6 Easy -> Medium, 5 Medium -> Hard, 4 Hard -> Extreme.
- [x] Public views (`/live`, scoreboard) display only competitor name and college (no team members).
- [x] Zero exposure of `solution_code`, `admin_notes`, or hidden test cases in public/participant APIs.
