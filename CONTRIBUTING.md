# Contributing to the-bar

Thanks for your interest in contributing. This document explains how to get the project running locally, run tests, and submit changes.

## Prerequisites

- **Go** (see [go.mod](go.mod) for the required version)
- **Node.js** (for the web client)
- **Rust** (optional; only needed for the Tauri desktop app)

## Getting started

1. **Clone the repository**

   ```bash
   git clone https://github.com/Curious-Keeper/the-bar.git
   cd the-bar
   ```

2. **Run the server**
   From the project root you can use the Makefile or run Go directly:

   ```bash
   make run
   # or
   go run ./cmd/server
   ```

   The server listens on TCP `:9000` and HTTP/WebSocket `:8080` by default. See [Configuration](https://the-b4r.netlify.app/wiki/configuration) and [.env.example](.env.example) for configuration.

3. **Run the web client (development)**

   ```bash
   cd web
   npm install
   npm run dev
   ```

   Open http://localhost:5173. Set `VITE_WS_URL` in `web/.env` if the server is not at `http://localhost:8080` (see `web/.env.example`).

4. **Optional: desktop app (Tauri)**
   From the project root:
   ```bash
   npm run tauri dev
   ```
   Requires Rust and a WebView runtime. See [Desktop App](https://the-b4r.netlify.app/wiki/desktop-app).

## Running tests

- **Go (server, packages)**

  ```bash
  make test
  # or
  go test ./...
  ```

- **Web client**

  ```bash
  cd web
  npm run test
  ```

- **E2E (Playwright)**  
  Requires the Go server and built chat app. From project root: start the server (e.g. `go run ./cmd/server` with `ACCESS_CODE` set), then in another terminal:

  ```bash
  cd web && npm run build && npx playwright test
  ```

  Or set `PLAYWRIGHT_BASE_URL` and `E2E_ACCESS_CODE` to point at a running instance. See `web/e2e/` and CI workflow (`.github/workflows/ci.yml`, job `e2e`) for the full flow.

- **Web: dependency audit**  
  Before submitting a PR that touches `web/` dependencies, run `npm audit` in `web/` and fix critical or high issues where practical. Document any accepted risk or temporary suppressions.

- **Lint (Go)**
  ```bash
  make lint
  ```
  Optionally install [golangci-lint](https://golangci-lint.run/) for additional checks; the Makefile runs it when available.

- **Format (Go)**  
  CI checks that Go code is formatted with `gofmt`. Before pushing, run:
  ```bash
  gofmt -w ./cmd ./internal ./pkg
  ```
  Or format the whole tree: `gofmt -w .` Most editors can format Go on save.

## Submitting changes

1. Create a branch from `main` (or `master`).
2. Make your changes. Keep commits focused and messages clear.
3. Run `make test`, `cd web && npm run test`, and ensure Go code is formatted (`gofmt -w ./cmd ./internal ./pkg`) so CI will pass.
4. Open a pull request. Describe what you changed and why.
5. CI will run build, tests, vet, and format checks. Address any failures.

## License and contributions

By submitting a pull request or other contribution, you grant the project maintainer(s) a perpetual, irrevocable, worldwide, non-exclusive license to use, modify, distribute, and sublicense your contribution under any terms (including proprietary or commercial licenses), and you represent that you have the right to grant this license. The project is [proprietary with a free tier for personal/non-commercial use](LICENSE); corporate and commercial use require a separate license from the copyright holder.

For configuration and feature details, see [README.md](README.md) and the [wiki](https://the-b4r.netlify.app/wiki). The [E2E and tamper detection roadmap](https://the-b4r.netlify.app/wiki/e2e_and_tamper) describes planned steps for privacy-focused messaging; the [join modes doc](https://the-b4r.netlify.app/wiki/join_modes) describes current and planned join behavior.

## Secrets

- **Never commit `.env` or `web/.env`.** They are listed in [.gitignore](.gitignore). Use [.env.example](.env.example) and `web/.env.example` as templates only.
- If `.env` or any secret is ever exposed, rotate those credentials immediately and revoke any compromised keys.
- The chat server (and any optional services you run) read secrets from environment or `.env`; keep these files out of version control and out of shared logs.

## Note on server behavior and the client

Contributors and instance operators can change server behavior (e.g. logging or persistence). The client shows what the server reports (e.g. logging and persistence settings) as an advisory indicator; it cannot verify that the server is unmodified or that it is telling the truth. See [Privacy](https://the-b4r.netlify.app/wiki/privacy) for the trust model.
