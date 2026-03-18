.PHONY: build dev dev-backend dev-ui electron electron-mac electron-win electron-linux electron-all test lint clean \
        go-build-mac go-build-win go-build-linux

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

go-build-win: _ui-build
	GOOS=windows GOARCH=amd64 go build -o bin/pandorabox-win.exe   ./cmd/pandorabox

go-build-linux: _ui-build
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

electron-win: go-build-win
	cd ui && npx electron-builder --win

electron-linux: go-build-linux
	cd ui && npx electron-builder --linux

# Build for all platforms in one go
electron-all: go-build-mac go-build-win go-build-linux
	cd ui && npx electron-builder --mac --win --linux

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
