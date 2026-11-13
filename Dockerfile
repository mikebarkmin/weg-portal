# Multi-stage build for the WEG community portal.
#
# 1) ui        – build the React SPA (Vite) into ui/dist
# 2) build     – compile the static PocketBase Go binary (CGO disabled,
#                modernc.org/sqlite is pure Go)
# 3) runtime   – minimal Alpine image, non-root user, binary + healthcheck only

# ---------------------------------------------------------------- stage 1: UI
FROM docker.io/library/node:22-alpine AS ui

WORKDIR /src/ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY ui/ ./
RUN npm run build

# --------------------------------------------------------------- stage 2: Go
FROM docker.io/library/golang:1.27-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# the freshly built SPA replaces the checked-in placeholder ui/dist
COPY --from=ui /src/ui/dist ./ui/dist

RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /weg-portal ./base

# ------------------------------------------------------------ stage 3: runtime
FROM docker.io/library/alpine:3.21

RUN apk add --no-cache ca-certificates tzdata \
    && adduser -D -H -u 10001 nonroot

WORKDIR /app
COPY --from=build /weg-portal /app/weg-portal
# the app creates pb_data/ at runtime as the non-root user
RUN mkdir /app/pb_data && chown -R nonroot:nonroot /app

USER nonroot:nonroot
EXPOSE 8080

# PocketBase exposes GET /api/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/api/health || exit 1

ENTRYPOINT ["/app/weg-portal"]
CMD ["serve", "--http=0.0.0.0:8080"]
