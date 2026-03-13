# the-bar: common targets for build, test, run, and Docker.
# Prerequisites: Go, Node (for web), optionally Rust (for Tauri). See README and CONTRIBUTING.

.PHONY: test build run lint docker-build docker-up docker-down clean build-client build-tauri-server

# Default target
all: test build

# Run all tests
test:
	go test ./...

# Build the chat server binary (output: ./server)
build:
	go build -o server ./cmd/server

# Run the chat server (TCP :9000, HTTP/WebSocket :8080 by default)
run:
	go run ./cmd/server

# Lint: vet and optional golangci-lint (install with: go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest)
lint:
	go vet ./...
	@command -v golangci-lint >/dev/null 2>&1 && golangci-lint run ./... || true

# Docker: build and run
docker-build:
	docker compose build

docker-up:
	docker compose up -d

docker-down:
	docker compose down

# Optional: build TCP client
build-client:
	go build -o client ./cmd/client

# Build Go server binary for Tauri desktop app (required before npm run tauri build)
build-tauri-server:
	@mkdir -p src-tauri/binaries
	@triple=$$(rustc -vV 2>/dev/null | sed -n 's/^host: //p'); \
	if [ -z "$$triple" ]; then triple="x86_64-unknown-linux-gnu"; fi; \
	go build -o src-tauri/binaries/thebar-server-$$triple ./cmd/server && \
	echo "Built src-tauri/binaries/thebar-server-$$triple"

# Remove built binaries
clean:
	rm -f server client
	rm -f src-tauri/binaries/thebar-server-*
