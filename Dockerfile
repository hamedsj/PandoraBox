# ── Stage 1: Build React UI ──────────────────────────────────────────────────
FROM node:22-alpine AS ui-builder
WORKDIR /app
COPY ui/package*.json ./ui/
RUN cd ui && npm ci --silent
COPY ui ./ui
RUN cd ui && npm run build

# ── Stage 2: Build Go binary ──────────────────────────────────────────────────
FROM golang:1.25-alpine AS go-builder
RUN apk add --no-cache git ca-certificates
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Copy the built UI into the embed path
COPY --from=ui-builder /app/ui/dist ./cmd/pandorabox/dist
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /pandorabox ./cmd/pandorabox

# ── Stage 3: Minimal runtime image ────────────────────────────────────────────
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
COPY --from=go-builder /pandorabox /usr/local/bin/pandorabox

# Data volume: pandora.db + project.json (the shared team project)
VOLUME ["/data"]
# Config volume: pandorabox-server.json
VOLUME ["/config"]

EXPOSE 7777
EXPOSE 7778

ENTRYPOINT ["pandorabox", "serve", "--team-server", "--server-config", "/config/pandorabox-server.json"]
