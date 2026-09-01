.PHONY: dev build test

dev:
	cd web && npm run dev &
	go run ./cmd/dblens/...

build:
	cd web && npm run build
	go build -o dblens ./cmd/dblens/...
