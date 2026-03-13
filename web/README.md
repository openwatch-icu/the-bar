# The Bar Chat – Web client

Browser client for the the-bar chat server. Connect with a username (or reconnect token), join channels, and send messages. Uses the same line protocol as the terminal client over WebSocket.

## Build targets

- **Marketing + wiki** (`npm run build` or `npm run build:marketing`): landing page and wiki only. Output: `dist/`. Deploy to your chosen domain.
- **Chat app** (`npm run build:app`): chat app only (no marketing or wiki). Output: `dist-app/`. Instance operators deploy this with their Go server (e.g. at `https://their-domain/bar`). Set `VITE_APP_BASE_PATH` and `VITE_WS_URL` when building for production.

## Running locally

1. Start the Go server (TCP on :9000, HTTP/WebSocket on :8080):
   ```bash
   go run ./cmd/server
   ```
2. From this directory: `npm install` then `npm run dev`. Open http://localhost:5173.
3. Enter a username and click Join. Use the sidebar to switch channels; type `/rooms` or click "Refresh rooms" to list channels.

Optional: set `VITE_WS_URL` in `web/.env` (e.g. if the server is on another host/port). See `web/.env.example`.
