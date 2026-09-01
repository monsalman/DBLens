# Stage 1: Build Frontend
FROM node:22-alpine AS frontend
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: Build Go Backend with Embedded Assets
FROM golang:1.25-alpine AS backend
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=frontend /app/web/dist ./cmd/dblens/dist
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /dblens ./cmd/dblens/...

# Stage 3: Final Scratch / Minimal Image
FROM alpine:3.20
RUN apk --no-cache add ca-certificates tzdata
WORKDIR /
COPY --from=backend /dblens /dblens

EXPOSE 8080
ENTRYPOINT ["/dblens"]
