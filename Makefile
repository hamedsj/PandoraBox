.PHONY: build dev dev-backend dev-ui electron electron-mac electron-win electron-linux test lint clean

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

# Dev: launch Electron wrapping the Go backend
dev-electron:
	go build -o bin/pandorabox ./cmd/pandorabox
	cd ui && npx electron .

# Package Electron app for current platform
electron: build
	cd ui && npm run electron:build

# Platform-specific Electron packages
electron-mac: build
	cd ui && npm run electron:build:mac

electron-win: build
	cd ui && npm run electron:build:win

electron-linux: build
	cd ui && npm run electron:build:linux

test:
	go test ./...

lint:
	golangci-lint run

clean:
	rm -rf bin/ ui/dist/ ui/dist-electron/ cmd/pandorabox/dist
