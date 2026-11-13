.PHONY: build run test ui-build ui-test

# build the portal binary
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)

build:
	go build -ldflags "-X main.Version=$(VERSION)" -o weg-portal ./base

# run the app in dev mode
run:
	go run ./base serve

# run all Go tests
test:
	go test ./... -count=1

# build the React UI into ui/dist
ui-build:
	cd ui && npm ci && npm run build

# run the UI unit tests
ui-test:
	cd ui && npm test
