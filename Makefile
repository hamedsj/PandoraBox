.PHONY: build dev dev-backend dev-ui electron electron-mac electron-mac-arm64 electron-win electron-win-x64 electron-linux electron-linux-x64 electron-all electron-all-64 test lint clean \
        go-build-mac go-build-mac-arm64 go-build-win go-build-win-x64 go-build-linux go-build-linux-x64

# Build the Go binary + embed the React UI (web mode)
build:
	cd ui && npm run build
	rm -rf cmd/pandorabox/dist
	cp -r ui/dist cmd/pandorabox/dist
	go build -o bin/pandorabox ./cmd/pandorabox

# Dev: run Go backend directly (UI served from Go embed)
dev-backend:
	go run ./cmd/pandorabox serve

# Dev: run Vite dev server (proxied to Go backend on 7777)
dev-ui:
	cd ui && npm run dev

# Dev: launch Electron wrapping the Go backend (full build so launcher has dist/index.html)
dev-electron: build
	cd ui && npx electron .

# ---------------------------------------------------------------------------
# Cross-compiled Go binaries (pure Go / no CGo — modernc.org/sqlite)
# ---------------------------------------------------------------------------

go-build-mac: _ui-build
	GOOS=darwin  GOARCH=arm64 go build -o bin/pandorabox-mac-arm64 ./cmd/pandorabox
	GOOS=darwin  GOARCH=amd64 go build -o bin/pandorabox-mac-x64   ./cmd/pandorabox

go-build-mac-arm64: _ui-build
	GOOS=darwin  GOARCH=arm64 go build -o bin/pandorabox-mac-arm64 ./cmd/pandorabox

go-build-win: _ui-build
	GOOS=windows GOARCH=amd64 go build -o bin/pandorabox-win.exe   ./cmd/pandorabox

go-build-win-x64: _ui-build
	GOOS=windows GOARCH=amd64 go build -o bin/pandorabox-win.exe   ./cmd/pandorabox

go-build-linux: _ui-build
	GOOS=linux   GOARCH=amd64 go build -o bin/pandorabox-linux      ./cmd/pandorabox

go-build-linux-x64: _ui-build
	GOOS=linux   GOARCH=amd64 go build -o bin/pandorabox-linux      ./cmd/pandorabox

# ---------------------------------------------------------------------------
# Electron packaging (each target cross-compiles Go first, then builds UI)
# ---------------------------------------------------------------------------

# Build React UI once (shared by all platform targets)
_ui-build:
	cd ui && npm run build
	rm -rf cmd/pandorabox/dist
	cp -r ui/dist cmd/pandorabox/dist

electron-mac: go-build-mac
	cd ui && npx electron-builder --mac

# package.json's mac target builds both arm64 and x64 dmg/zip regardless of
# the --arm64 flag below, so both Go binaries must be fresh — depend on
# go-build-mac (not go-build-mac-arm64) or the x64 artifacts ship a stale binary.
electron-mac-arm64: go-build-mac
	cd ui && npx electron-builder --mac --arm64

electron-win: go-build-win
	cd ui && npx electron-builder --win

electron-win-x64: go-build-win-x64
	cd ui && npx electron-builder --win --x64

electron-linux: go-build-linux
	cd ui && npx electron-builder --linux

electron-linux-x64: go-build-linux-x64
	cd ui && npx electron-builder --linux --x64

# Build for all platforms in one go
electron-all: go-build-mac go-build-win go-build-linux
	cd ui && npx electron-builder --mac --win --linux

# Build arm64 macOS + x64 Windows/Linux
electron-all-64: electron-mac-arm64 electron-win-x64 electron-linux-x64

# Package Electron app for the current host platform (dev convenience)
electron: build
	cd ui && npm run electron:build

# ---------------------------------------------------------------------------

test:
	go test ./...

lint:
	golangci-lint run

clean:
	rm -rf bin/ ui/dist/ ui/dist-electron/ cmd/pandorabox/dist
