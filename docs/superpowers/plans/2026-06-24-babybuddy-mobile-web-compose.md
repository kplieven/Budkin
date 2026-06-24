# BabyBuddy Mobile Web Compose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and run a production-style Expo web container on homeservers, exposed at host port 1235.

**Architecture:** Use a multi-stage Docker build: Node builds Expo static web assets, nginx serves them in a minimal runtime image. A single compose service publishes port 1235 to container port 80 with restart policy.

**Tech Stack:** Docker, Docker Compose, Node 20, Expo SDK 56 export, nginx alpine

---

### Task 1: Add multi-stage web image build

**Files:**
- Create: `Dockerfile.web`

- [ ] **Step 1: Write the failing verification command**

```bash
docker build -f Dockerfile.web .
```

Expected: FAIL with `failed to read dockerfile` (file does not exist yet).

- [ ] **Step 2: Create `Dockerfile.web` with minimal production build/runtime**

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx expo export --platform web

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

- [ ] **Step 3: Run build to verify image builds**

Run:

```bash
docker build -f Dockerfile.web . -t babybuddy-mobile-web:test
```

Expected: PASS and final output includes `Successfully tagged babybuddy-mobile-web:test`.

- [ ] **Step 4: Commit Task 1**

```bash
git add Dockerfile.web
git commit -m "feat(docker): add multi-stage web image build"
```

### Task 2: Add compose service for homeserver deployment

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Write failing runtime verification command**

```bash
docker compose up -d --build
```

Expected: FAIL with `no configuration file provided` (compose file does not exist yet).

- [ ] **Step 2: Create `docker-compose.yml`**

```yaml
services:
  babybuddy_mobile_web:
    build:
      context: .
      dockerfile: Dockerfile.web
    container_name: babybuddy_mobile_web
    ports:
      - "1235:80"
    restart: unless-stopped
```

- [ ] **Step 3: Verify compose service starts**

Run:

```bash
docker compose up -d --build
docker compose ps
```

Expected: PASS and service `babybuddy_mobile_web` is `Up`.

- [ ] **Step 4: Verify HTTP response**

Run:

```bash
curl -I http://localhost:1235
```

Expected: PASS with `HTTP/1.1 200 OK`.

- [ ] **Step 5: Commit Task 2**

```bash
git add docker-compose.yml
git commit -m "feat(docker): add homeserver compose service for expo web"
```
