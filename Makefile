.PHONY: build run test ui-build ui-test

# build the portal binary
build:
	go build -o weg-portal ./base

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
