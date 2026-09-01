# DBLens — Implementation Plan

Modern, self-hosted, single-binary Database Studio.
Designed to replace Adminer with multi-connection management, Docker Compose self-hosting, and a Drizzle Studio developer experience.

---

## 1. Overview & Vision

**Target Deployment Model**: 100% Self-Hosted.
Users spin up DBLens via Docker Compose, Docker run, or a single binary on their private VPS/Homelab/Dev machine without external SaaS dependencies.

**Key Advantages vs Adminer**:
1. **Multi-Connection Workspace**: Connect and switch between multiple databases simultaneously (e.g., 2x PostgreSQL + 2x MySQL + SQLite) in a single unified dashboard without re-logging.
2. **Docker-First Self-Hosting**: 1-step deployment with `docker-compose.yml` (zero configuration needed, persistence via optional volume mount).
3. **Drizzle Studio-class UX**: Spreadsheet-like inline cell editing, fluid filtering, keyboard shortcuts, dark/light mode, and live foreign-key relation exploration.
4. **Single Static Binary**: Go backend embeds React frontend assets (`embed.FS`). 20MB RAM idle, instant boot (<10ms).
5. **Safety Guards**: Transaction dry-run modal, Primary Key safe editing, read-only connection locks.

---

## 2. Self-Hosting & Deployment Architecture

### Docker Compose Example (Adminer drop-in replacement)

```yaml
version: "3.8"

services:
  dblens:
    image: dblens/dblens:latest
    container_name: dblens
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - DBLENS_AUTH_PASSWORD=secret-admin-pass # Optional app-level master lock
      - DBLENS_STORAGE_PATH=/data             # Saves connection profiles & history
    volumes:
      - dblens_data:/data

volumes:
  dblens_data:
```

### Multi-Database Setup in Compose (Stack example)

```yaml
version: "3.8"

services:
  dblens:
    image: dblens/dblens:latest
    ports:
      - "8080:8080"
    environment:
      # Optional: pre-seed connections via env var
      - DBLENS_CONNECTIONS=postgres://app:pass@pg-primary:5432/main_db,mysql://root:pass@mysql-auth:3306/auth_db
    depends_on:
      - pg-primary
      - mysql-auth

  pg-primary:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: main_db

  mysql-auth:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: pass
      MYSQL_DATABASE: auth_db
```

---

## 3. Tech Stack

### Backend Engine
- **Language**: **Go (Golang)**
  - Fast startup (<10ms), low memory footprint (<20MB idle), single static binary.
  - Native asset embedding (`embed.FS`).
- **HTTP Routing & API**: `net/http` + `chi` (lightweight, zero-bloat).
- **Session & Connection Manager**:
  - Connection Pool Manager maintaining active database handles concurrently (`map[connectionID]*sql.DB`).
  - Thread-safe connection switching and query dispatch.
- **Local Persistence** (Saved connections & query history):
  - Embedded SQLite / encrypted JSON file in `/data`.
- **Database Drivers**:
  - PostgreSQL: `github.com/jackc/pgx/v5`
  - MySQL / MariaDB: `github.com/go-sql-driver/mysql`
  - SQLite / libSQL: `modernc.org/sqlite` (Pure Go, no CGO requirement for cross-compilation)
  - ClickHouse: `github.com/ClickHouse/clickhouse-go/v2`

### Frontend Application
- **Framework**: **React 19 + Vite + TypeScript**
- **Styling**: **Tailwind CSS v4** + **shadcn/ui** primitives + Lucide Icons.
- **Multi-Tab / Connection Store**: Zustand with persistent storage.
- **State & Data Fetching**: TanStack Query (`@tanstack/react-query`).
- **Data Grid**: `@tanstack/react-table` + `@tanstack/react-virtual` (virtual scroll handling 100k+ rows without lag).
- **SQL Editor**: CodeMirror 6 (`@codemirror/lang-sql`) with multi-dialect auto-complete and syntax highlighting.
- **Schema Visualizer (ERD)**: `@xyflow/react` (React Flow) for interactive relationship diagrams.

---

## 4. Multi-Connection Architecture Design

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Frontend (React Studio)                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Connection Selector Bar: [PG: prod-db] [PG: staging] [MySQL: auth]│  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│  ┌─────────────────┐ ┌──────────────▼─┐ ┌───────────────────────────┐  │
│  │ Data Grid Table │ │  SQL Editor    │ │  Schema Visualizer (ERD)  │  │
│  └────────┬────────┘ └────────┬───────┘ └─────────────┬─────────────┘  │
│           └───────────────────┼───────────────────────┘                │
│                 Header: `X-Connection-ID: <id>`                        │
└───────────────────────────────┼────────────────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────────────┐
│                       Go Backend Engine                                │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ HTTP API Server & Static Embed (`embed.FS`)                      │  │
│  └────────────────────────────┬─────────────────────────────────────┘  │
│                               │                                        │
│  ┌────────────────────────────▼─────────────────────────────────────┐  │
│  │ Connection Pool Registry (`internal/connection/pool.go`)         │  │
│  │  - ID: conn_pg_1     -> pgxpool.Pool (postgres://...)             │  │
│  │  - ID: conn_pg_2     -> pgxpool.Pool (postgres://...)             │  │
│  │  - ID: conn_mysql_1  -> sql.DB (mysql://...)                      │  │
│  │  - ID: conn_mysql_2  -> sql.DB (mysql://...)                      │  │
│  │  - ID: conn_sqlite_1 -> sql.DB (file:/data/app.db)                │  │
│  └────────────────────────────┬─────────────────────────────────────┘  │
│                               │                                        │
│  ┌────────────────────────────▼─────────────────────────────────────┐  │
│  │ Universal Driver Adapter Interface                               │  │
│  │  - InspectSchema(connID)                                         │  │
│  │  - ExecuteQuery(connID, sql, params)                             │  │
│  │  - MutateRow(connID, table, diff)                                │  │
│  │  - ExportData(connID, table, format)                             │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Feature Matrix

### 1. Multi-Connection Hub
- [x] **Simultaneous DB Connections**: Add and manage multiple PostgreSQL, MySQL, MariaDB, SQLite instances.
- [x] **Quick Switcher**: Jump between databases/tables in 1 click or keyboard shortcut (`Cmd+K`).
- [x] **Pre-seeded Env Connections**: Pass connection URIs via `DBLENS_CONNECTIONS` environment variable in Docker Compose for zero-touch configuration.
- [x] **Saved Profiles**: Save local connection profiles with custom labels, color badges (e.g. Red for Prod, Green for Dev), and read-only flags.

### 2. Drizzle-like Data Studio
- [x] **Spreadsheet Data Grid**:
  - Double-click inline cell editing (auto-detects PK, generates safe `UPDATE WHERE id = ?`).
  - Add single/bulk rows inline.
  - Delete selected rows with confirmation modal.
  - Column reorder, pin/freeze column, hide/show column.
  - Quick filter bar (visual condition builder: `AND`, `OR`, `IS NULL`, `CONTAINS`, `=`).
  - Column sort (multi-column support).
  - Virtualized rendering for fluid 60fps scrolling on massive tables.
- [x] **Foreign Key Peek & Navigation**:
  - Click on FK values to inspect related records in popover drawer without leaving current table.

### 3. SQL Console & Multi-DB Query Runner
- [x] **CodeMirror 6 SQL Editor**:
  - Auto-completion dynamically switched based on selected connection dialect.
  - Multi-statement execution.
  - Query history per connection with execution duration, row counts, and timestamp.
  - Explain / Analyze query execution plan visualizer.
  - Format SQL query shortcut (`Cmd+Shift+F`).

### 4. Schema & Visualizer (ERD)
- [x] **Interactive ERD (Entity Relationship Diagram)**:
  - Auto-generated graph showing table relations and foreign keys for the active connection.
  - Node drag & drop, zoom, mini-map, search table in graph.
  - Export diagram as PNG/SVG.
- [x] **Table Management (DDL UI)**:
  - Create table GUI.
  - Add / Drop / Rename columns.
  - Add / Drop indexes and foreign keys.
  - Truncate / Drop table.

### 5. Import & Export
- [x] **Export formats**: CSV, JSON, NDJSON, SQL INSERT dump.
- [x] **Import formats**: CSV, JSON, raw SQL script.

### 6. Resource Efficiency & Low-Footprint Architecture (Anti-Server-Bloat)
Agar DBLens bisa berjalan mulus di VPS termurah ($3-$5/bln, 512MB-1GB RAM) tanpa menguras CPU/Memory:
- [x] **Lazy Connection & Auto-Idle Disconnect**:
  - Pool database hanya dibuka saat ada request query (`On-Demand`).
  - Koneksi idle otomatis di-close setelah timeout (misal: 15 menit tanpa aktivitas) agar tidak memakan connection pool target database.
- [x] **Streaming / Chunked Response (Zero Buffer Bloat)**:
  - Ekspor data (CSV/JSON/SQL Dump) dan query jutaan baris menggunakan **HTTP Chunked Streaming**. Data langsung di-stream ke browser tanpa di-buffer di RAM server Go.
- [x] **Hard Query Safety Limits**:
  - Auto-append `LIMIT 100` / `LIMIT 500` pada UI browser tabel secara default untuk mencegah crash karena `SELECT * FROM massive_table`.
  - Configurable query execution timeout (default 30s) agar tidak ada query gantung yang membebani CPU.
- [x] **Client-Side Heavy Processing (Offload to Browser)**:
  - Rendering ERD visualizer, formatting SQL, schema diffing, sorting virtual table dilakukan di browser pengguna (Client CPU), bukan di server.
- [x] **Lightweight Cache Metadata**:
  - Cache struktur schema (list tables & columns) di memori hanya untuk active session, invalidasi otomatis saat DDL dijalankan.
- [x] **Single Binary < 25MB & Idle RAM < 15MB**:
  - Pure Go compiled static binary tanpa runtime interpreter (no Node runtime on server, no PHP FPM).

### 7. Security & Production Safety
- [x] **Master Password Auth**: Optional single-password protection (`DBLENS_AUTH_PASSWORD`).
- [x] **Read-Only Mode Toggle**: Prevent accidental write/drop on production connections.
- [x] **Audit / Dry-Run Modal**: Show exact generated SQL before applying inline updates/deletes.
- [x] **Zero-Telemetry**: 100% offline-ready, zero phone-home scripts.

---

## 6. Directory Structure

```
dblens/
├── cmd/
│   └── dblens/
│       └── main.go           # CLI entry point, flag & env parser, server start
├── internal/
│   ├── api/                  # HTTP handlers & router
│   ├── connection/           # Multi-connection pool manager & registry
│   ├── config/               # App config & saved profiles store
│   ├── driver/               # Universal DB driver adapters
│   │   ├── adapter.go        # Driver interface
│   │   ├── postgres/
│   │   ├── mysql/
│   │   └── sqlite/
│   └── server/               # Static embed server + auth middleware
├── web/                      # React SPA Frontend
│   ├── src/
│   │   ├── components/       # shadcn & layout UI
│   │   ├── features/
│   │   │   ├── connections/  # Multi-connection bar & switcher
│   │   │   ├── grid/         # Table spreadsheet grid
│   │   │   ├── editor/       # CodeMirror SQL editor
│   │   │   └── erd/          # ReactFlow ERD
│   │   ├── hooks/
│   │   ├── stores/           # Zustand connection & UI state
│   │   ├── lib/
│   │   └── App.tsx
│   ├── package.json
│   └── vite.config.ts
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
├── Makefile
├── go.mod
└── README.md
```

---

## 7. Development Roadmap & Milestones

### Phase 1: Multi-Connection Engine & Core API (Week 1 - 2)
- Scaffold Go server + connection pool registry (`map[string]*Driver`).
- Implement PostgreSQL, MySQL, SQLite drivers.
- Support pre-seeding via `DBLENS_CONNECTIONS` env var.
- Implement API endpoints:
  - `GET /api/connections` (list active connections)
  - `POST /api/connections` (connect new DB)
  - `DELETE /api/connections/{id}` (disconnect)
  - `GET /api/{connId}/schema`
  - `POST /api/{connId}/query`
  - `POST /api/{connId}/mutate`

### Phase 2: Frontend Studio & Multi-Connection Switcher (Week 3 - 4)
- Setup React + Tailwind v4 + shadcn/ui.
- Build Multi-Connection tabs bar & quick switcher (`Cmd+K`).
- Implement Virtual Table Grid with inline cell edit & PK update generator.
- Implement visual Filter/Sort builder.

### Phase 3: SQL Console, History & Schema ERD (Week 5 - 6)
- CodeMirror 6 with dialect-aware autocomplete.
- Interactive ERD diagram with `@xyflow/react`.
- DDL table manager GUI.

### Phase 4: Self-Hosting Distribution & Docker (Week 7 - 8)
- Build multi-arch Docker image (`linux/amd64`, `linux/arm64`).
- Write sample `docker-compose.yml` templates.
- Optional master password authentication (`DBLENS_AUTH_PASSWORD`).
- Publish Docker Hub image & binary releases.

