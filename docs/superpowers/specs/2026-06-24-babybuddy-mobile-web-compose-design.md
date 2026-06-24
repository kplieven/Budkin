# BabyBuddy Mobile Web Compose Design

## Goal
Run a production-style containerized web server for the Expo web target on homeservers, exposed on a fixed host port, to be reverse-proxied externally alongside Baby Buddy.

## Constraints
- No bundled reverse proxy in this stack.
- Build from source inside Docker.
- Expose host port `1235`.
- Keep runtime lean and restart automatically.

## Architecture
1. **Build stage (Node)**: install dependencies and export static web assets from Expo.
2. **Runtime stage (nginx)**: serve exported static files.
3. **Compose service**: single service named `babybuddy_mobile_web`, with `restart: unless-stopped`, publishing `1235:80`.

## Components
- `Dockerfile.web` (new): multi-stage build for Expo web output and nginx runtime.
- `docker-compose.yml` (new): service definition with build context and published port.

## Data Flow
1. `docker compose build` triggers Docker build.
2. Build stage runs `npm ci` and `npx expo export --platform web`.
3. Exported static output is copied into nginx document root.
4. `docker compose up -d` starts nginx serving the app on container port 80.
5. Host port `1235` exposes the app to the external reverse proxy layer.

## Error Handling
- Build failures (dependency/install/export) fail the image build immediately.
- Runtime issues are surfaced via container status/logs from nginx.
- No silent fallbacks; startup succeeds only when static assets are present.

## Validation
- `docker compose up -d --build` completes successfully.
- `curl http://localhost:1235` returns an HTML response.
- Container remains healthy/restarting per `unless-stopped` policy.

## Out of Scope
- Reverse proxy/TLS configuration.
- Baby Buddy service orchestration changes.
