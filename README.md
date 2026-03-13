# The-bar

**Privacy-first chat: single-tenant, invite-only, no face/ID verification, no cross-tracking, minimal data. Protect users through design—not surveillance.**

A self-hosted chat server and web client you can run as a viable alternative to Slack/Discord. See our [Privacy](https://the-b4r.netlify.app/wiki/privacy) stance, [how truly secure communications work](https://the-b4r.netlify.app/wiki/security-concepts) (E2E, attestation, pinning), and the [E2E and tamper detection roadmap](https://the-b4r.netlify.app/wiki/e2e_and_tamper).

## Prerequisites

- **Go 1.23+** (for the server)
- **Node.js** (for building/running the web client)

## Quick start

### 1. Run the server

```bash
go run ./cmd/server
```

Server listens on **TCP :9000** and **HTTP/WebSocket :8080** by default. Data is stored in `./chatdata` (WAL + snapshots).

### 2. Run the web client (dev)

```bash
cd web
npm install
npm run dev
```

Open http://localhost:5173 (or http://localhost:5173/default).

For a named instance use the path, e.g. http://localhost:5173/[YOUR_SLUG_HERE]. Set `VITE_WS_URL` and optionally `VITE_INSTANCE_SLUG` in `web/.env` if the server or instance slug differs. When the server uses TLS, set `VITE_WS_URL=https://localhost:8080` so the client uses WSS; optional `VITE_HTTP_SCHEME`, `VITE_SERVER_HOST`, `VITE_SERVER_PORT` build the default URL when `VITE_WS_URL` is unset. Self-hosters can set `VITE_APP_BASE_PATH` to serve the app at a custom path (defaults to `/`).

### 3. Connect

Enter a username and click Join. The app stores your reconnect token per instance and username, so next time you can enter the same username and click Join to auto-reconnect without pasting the token. Use the sidebar to switch channels.

**Resetting sessions (testing):** Restarting the server clears all in-memory sessions. For a running server, set `ENABLE_RESET_SESSIONS=1` and type `/reset-sessions` in chat to clear all sessions so any name can join again.

## Configuration

Server configuration is via environment variables or `.env` (see [.env.example](.env.example)). Full reference: [Configuration](https://the-b4r.netlify.app/wiki/configuration). For WebSocket disconnects and keeping sessions open, see [Staying Connected](https://the-b4r.netlify.app/wiki/staying-connected).

## Graceful shutdown

The server handles SIGINT (Ctrl+C) and SIGTERM: it stops accepting new connections, flushes state (final snapshot, closes WAL), and exits. Use with systemd, Docker, or Kubernetes as needed.

## Documentation

All project documentation is maintained in the
[the-bar-site](https://github.com/Curious-Keeper/the-bar-site) repo
and published at https://the-b4r.netlify.app/wiki.

For local access, symlink the docs directory:

    ln -s ../the-bar-site/docs docs

| Topic                                                     | Doc                                                                              |
| --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Server configuration (env vars, private rooms, retention) | [Configuration](https://the-b4r.netlify.app/wiki/configuration)                  |
| Staying connected (WebSocket, timeouts, heartbeat)        | [Staying Connected](https://the-b4r.netlify.app/wiki/staying-connected)          |
| I2P (optional transport)                                  | [I2P](https://the-b4r.netlify.app/wiki/i2p)                                     |
| TLS and local development (certs, LAN, troubleshooting)   | [TLS & Local Dev](https://the-b4r.netlify.app/wiki/tls-and-local-dev)            |
| Docker                                                    | [Docker](https://the-b4r.netlify.app/wiki/docker)                                |
| Desktop app (Tauri)                                       | [Desktop App](https://the-b4r.netlify.app/wiki/desktop-app)                      |
| Roadmap                                                   | [Roadmap](https://the-b4r.netlify.app/wiki/roadmap)                              |
| E2E and tamper detection                                  | [E2E & Tamper Detection](https://the-b4r.netlify.app/wiki/e2e_and_tamper)        |
| Join modes (session vs account)                           | [Join Modes](https://the-b4r.netlify.app/wiki/join_modes)                        |
| Local setup (dependencies, tools)                         | [Setup](https://the-b4r.netlify.app/wiki/setup)                                  |
| External references                                       | [References](https://the-b4r.netlify.app/wiki/references)                        |

## Licensing

Commercial use requires a license from the copyright holder (see [LICENSE](LICENSE)). Personal and non-commercial use are permitted under the repository license. License validation is supported by the server and desktop app when you have a license key and validation URL from the copyright holder; the tooling to run a license server is not part of this repository.

## License

See repository license file
