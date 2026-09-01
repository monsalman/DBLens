# DBLens — V2 Implementation Plan

Modern, persistent database studio built on Drizzle Studio DNA — clean, dense, keyboard-first. No AI-slop. Zero bloat.

---

## 1. Masalah Saat Ini

| # | Masalah | Dampak |
|---|---------|--------|
| 1 | Koneksi hilang setelah refresh/restart | User harus re-input setiap kali |
| 2 | Tampilan "No records in table" meskipun DB sudah konek | Data tidak ditampilkan, hanya mock/empty state |
| 3 | Design terlalu generik/boring (background zinc-950, border default) | Nampak seperti template React boilerplate |
| 4 | Image tag random (`2cec95f`, `437cb69`) | Sulit track versi yang dipakai |
| 5 | Tidak ada save connection profile ke storage | User experience buruk, mirip Adminer tapi worse |

---

## 2. Target UX (Drizzle Studio Inspired)

### Philosophy: Dense Information Density, Keyboard First
- **No hero sections**, no gradients, no decorative shapes
- **Monospace data**, sans-serif labels
- **Subtle borders** (zinc-800/#27272a), high contrast text
- **Color-coded dialect badges**: 🟦 PG, 🟩 MySQL, 🟨 SQLite
- **Zero animation bounce** — instant transitions only

### Visual Structure
```
┌─────────────────────────────────────────────────────┐
│ ╔══════╗ ┌──────────────────┐  ┌─────────────────┐ │
│ ║ DBLS ║ │ [PG] Production  │  │  [+ Add Conn]   │ │
│ ╚══════╝ │ ● conn_1         │  │                  │ │
│          │ ○ conn_mysql     │  │    [v0.1.0] 🔴RO│ │
│          └──────────────────┘  └─────────────────┘ │
├──────────────────────┬──────────────────────────────┤
│ SCHEMA  ▼            │                              │
│ ├── public           │  Table Data                    │
│ │ ├── users (1.4k)   │  ┌────┬──────────────────────┐ │
│ │ ├── orders (850)   │  │☐ id│ email    │ name       │ │
│ │ └── config (12)    │  ├────┼──────────────────────┤ │
│ ├── auth             │  │⊡ usr│ a@b.com  │ Alice     │ │
│ └── analytics        │  │⊡ usr│ c@d.net  │ Bob       │ │
│                      │  │     │ ...              │ │
│ TABS                 │  └────┴──────────────────────┘ │
│ • Table Data  ← active│                                │
│ • SQL Console         │  ⬅ 100 rows  ←  page 1 / 20  │
│ • Schema ERD          │                                │
└──────────────────────┴──────────────────────────────┘
```

---

## 3. Arsitektur Peningkatan

### A. Persistent Connection Storage

```
┌───────────────────────────────────────────────┐
│              Frontend (Zustand)               │
│  ┌─────────────────────────────────────────┐  │
│  │ addConnection() → POST /api/profiles    │  │
│  │ deleteConnection(id) → DELETE /api/profi│  │
│  └──────────────────────┬──────────────────┘  │
│                         │                       │
│  ┌──────────────────────▼──────────────────┐  │
│  │ GET /api/profiles → setConnections()    │  │
│  │ (auto-load on mount, persist in localSto │  │
│  └─────────────────────────────────────────┘  │
└──────────────┬────────────────────────────────┘
               │
┌──────────────▼────────────────────────────────┐
│              Go Backend                        │
│  ┌──────────────────────────────────────────┐ │
│  │ POST/DELETE/GET /api/profiles            │ │
│  │  - Store encrypted DSN in JSON file      │ │
│  │  - Path: ~/.config/dblens/connections.json│ │
│  │  - Or env: DBLENS_DATA_DIR for Docker    │ │
│  └──────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────┐ │
│  │ Manager persists connections to disk     │ │
│  │ On startup: load profiles + reconnect    │ │
│  │ Lazy-connect: open driver on first query │ │
│  └──────────────────────────────────────────┘ │
└────────────────────────────────────────────────┘
```

### B. Data Fetching Pipeline Fix

Masalah saat ini: Frontend memanggil API endpoint salah atau data tidak di-parse dengan benar.

```
Fix Flow:
1. GET /api/profiles → return saved connections array
2. User click "Connect" → backend opens driver + returns status
3. GET /api/connections/{id}/tables?schema=public → real schema
4. POST /api/connections/{id}/tables/{table}/data → real paginated rows
5. Response format unified: { data: [...], error: null }
6. Frontend unwrap json.data consistently everywhere
```

### C. Version-Based Release Tagging

```yaml
# docker/Dockerfile - tambah build arg version
ARG VERSION=0.1.0
LABEL org.opencontainers.image.version=${VERSION}
ENV DBLENS_VERSION=${VERSION}

# Main app reads version from env and shows it
```

Semua image tagged sebagai:
- `monsalman/dblens:0.1.0`
- `monsalman/dblens:latest` (same as 0.1.0)
- CI auto-increment minor on every push to main

---

## 4. Feature Matrix Detail

### 4.1 Connection & Profile Management (Priority: P0)
- [ ] `POST /api/profiles` — Save connection profile (label, DSN, color, readOnly flag)
- [ ] `DELETE /api/profiles/:id` — Delete saved profile
- [ ] `GET /api/profiles` — Load all saved profiles on app start
- [ ] Storage: JSON file at `$DBLENS_DATA_DIR/connections.json` (or `~/.config/dblens/` locally)
- [ ] Encryption optional: base64 encode password part of DSN
- [ ] Auto-reconnect on server restart (load profiles + lazy-init drivers)
- [ ] Frontend: sidebar shows saved connections list (persisted across refresh)

### 4.2 Real Data Display (Priority: P0)
- [ ] Fix all frontend-to-backend API calls to use correct endpoints:
  - `/api/connections/{id}/schemas`
  - `/api/connections/{id}/tables?schema=X`
  - `/api/connections/{id}/tables/{name}/data` (POST with filter/pagination body)
  - `/api/connections/{id}/query` (POST raw SQL)
  - `/api/connections/{id}/mutate` (POST insert/update/delete)
- [ ] Proper response unwrapping everywhere: `json.data ?? json`
- [ ] Default LIMIT 100 rows per page (not loading entire table)
- [ ] Pagination controls: prev/next, page selector, rows-per-page dropdown (50, 100, 250)
- [ ] Column sorting (click header), filtering (search bar, column filters)
- [ ] Row count badge in sidebar (e.g., `users (1,420)`)
- [ ] Empty state: "No tables found in schema" NOT "No records in table"

### 4.3 Design Overhaul (Priority: P1)
- [ ] Apply **Graphite** or **Clean Slate** dark theme via shadcn MCP
  - Dark background: `#0f1117` (deeper than zinc-950)
  - Borders: `1px solid rgba(255,255,255,0.06)`
  - Text: monospace for data (`font-mono`), sans-serif for UI
  - Accent color: indigo/violet subtle glow, no rainbow gradients
- [ ] Remove all mock data fallback from frontend (break early, show error)
- [ ] Sidebar: compact tree view, not spaced-out cards
- [ ] Header: minimal — logo, connection pill(s), add button, version badge
- [ ] Tables: tight row padding, monospace cell values, striped hover
- [ ] SQL Editor: CodeMirror 6 with one-dark theme, line numbers, run shortcut visible
- [ ] ERD: clean node layout, FK edges dashed, clickable nodes

### 4.4 Additional Adminer-Like Features (Priority: P2)
- [ ] **Database selector** in sidebar (switch between databases within one connection)
- [ ] **Table metadata view** (columns, types, sizes, indexes, foreign keys)
- [ ] **DDL viewer** — generate CREATE TABLE SQL for any selected table
- [ ] **Export** — CSV, JSON, SQL dump (with proper streaming)
- [ ] **Import** — CSV/SQL upload via file input
- [ ] **Query history** persisted in localStorage
- [ ] **Read-only mode toggle** — disable inline editing + mutate endpoints blocked

---

## 5. File Changes Required

### Backend (Go)
| File | Change |
|------|--------|
| `internal/connection/manager.go` | Add `SaveProfiles()`, `LoadProfiles()`, persist to JSON file |
| `internal/api/handlers.go` | Add `GET/POST/DELETE /api/profiles` endpoints |
| `cmd/dblens/main.go` | Add `-version` flag, read from `DBLENS_VERSION` env, inject into index.html |
| `go.mod` | Add `github.com/golang-jwt/jwt/v5` if encryption needed later |

### Frontend (React)
| File | Change |
|------|--------|
| `web/src/stores/appStore.ts` | Persist full connection list, not just active state |
| `web/src/lib/api.ts` | Add `getProfiles()`, `createProfile()`, `deleteProfile()` |
| `web/src/features/connections/Sidebar.tsx` | Compact tree view with row counts, collapsible schemas |
| `web/src/features/connections/Header.tsx` | Minimal design, version badge, cleaner layout |
| `web/src/features/grid/TableGridView.tsx` | Fix data fetch logic, real pagination, remove mock data |
| `web/src/index.css` | Update to Graphite/Clean Slate palette via shadcn |
| `web/package.json` | Bump version number |

### CI/CD & Build
| File | Change |
|------|--------|
| `docker/Dockerfile` | Add `ARG VERSION`, label, ENV injection |
| `.github/workflows/docker-publish.yml` | Increment tag, prune old images |
| `docker/docker-compose.yml` | Update to use new image tag pattern |

---

## 6. Execution Order

### Sprint 1: Persistence & Connection Flow (2 days)
1. Add profile endpoints (Go) — CRUD operations + JSON file storage
2. Add manager persistence methods — load on startup, auto-reconnect
3. Update frontend store — persist connections array to Zustand+localStorage
4. Add frontend API methods — get/create/delete profiles
5. Test: add connection → refresh → connection still there

### Sprint 2: Real Data Pipeline (2 days)
6. Fix ALL API call paths in frontend to match backend routes
7. Fix response unwrapping — centralized helper function
8. Implement proper pagination in TableGridView
9. Show real row counts in sidebar (fetch via COUNT query)
10. Remove all mock data generation code
11. Test: connect PG → see real tables → see real rows

### Sprint 3: Design Pass (1 day)
12. Get Graphite theme via `shadcn apply_theme graphite`
13. Redesign Header — minimal, functional
14. Redesign Sidebar — compact tree, icons, badges
15. Redesign Table Grid — monospace data, tight rows, better empty states
16. Polish SQL Editor styling
17. Test: visual inspection, no AI-slop patterns

### Sprint 4: Packaging & Release (0.5 day)
18. Add version ARG to Dockerfile
19. Update GitHub Actions to use semantic versioning (0.1.0, 0.2.0)
20. Tag images properly, prune old tags in workflow
21. Update docker-compose example
22. Final deploy to Dokploy
