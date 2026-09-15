# DBLens Product & Feature Roadmap

DBLens is a modern, lightweight, single-binary database manager designed to be the modern alternative to Adminer, CloudBeaver, and phpMyAdmin.

## Status Legend
- 🟢 Completed / Merged
- 🟡 In Progress / PR Open
- ⚪ Planned / Ready to Build

---

## Phase 1: Core UX Parity & Quality (P0)

- [ ] **PR-1: Interactive SQL Studio & Search Fix**
  - Integrate CodeMirror 6 (`@uiw/react-codemirror`) with SQL syntax highlighting, line numbers, and dialect keywords.
  - Persistent query history drawer (past 50 queries in `localStorage`) with one-click re-run.
  - Fix fatal search filter bug (`column: "*"` causing syntax errors in drivers) and add column picker dropdown.
  - Wire existing `PeekDrawer.tsx` to FK badge clicks on grid cells.

- [ ] **PR-2: Spreadsheet Inline Editing & Row Mutation GUI**
  - Double-click cell to edit directly in `TableGridView`.
  - Wire to backend `api.mutateRow(UPDATE)`.
  - Add "+ Add Row" modal/drawer for inserting records with schema validation.

- [ ] **PR-3: One-Click Mock Data Generator (Killer Feature)**
  - Add "Generate Mock Data" button on table grid.
  - Inspect column types (names, emails, dates, ints, booleans, uuids) and generate 25 realistic rows.
  - Insert via batch mutation with rollback on failure.

---

## Phase 2: Administrative Depth & Data Portability (P1)

- [ ] **PR-4: Full Streaming Data Export & Import**
  - Full table export streaming endpoint (`GET /api/.../export?format=csv|json|sql`) instead of current 50-row memory dump.
  - File upload import for CSV and raw SQL script execution with progress indicator.

- [ ] **PR-5: Keyboard-First Command Palette (`Cmd+K` / `Ctrl+K`)**
  - Instant fuzzy search across connections, databases, schemas, and tables.
  - Quick action shortcuts (New SQL tab, Toggle theme, Disconnect, Refresh schema).

- [ ] **PR-6: Table Schema DDL Inspector**
  - Schema tab in table view: columns, data types, nullability, default values, indexes, and FK constraints.
  - "Generate DDL" button producing clean `CREATE TABLE` script with copy-to-clipboard.

---

## Phase 3: Developer Superpowers (P2)

- [ ] **PR-7: Multi-Tab SQL Console**
  - Tabbed query editor with renameable tabs (`Query 1`, `Scratchpad`, `Migration`).
  - Stored query bookmarks with tags.

- [ ] **PR-8: Visual EXPLAIN Query Plan**
  - Execute `EXPLAIN (ANALYZE, FORMAT JSON)` on PostgreSQL and `EXPLAIN FORMAT=JSON` on MySQL.
  - Render execution tree highlighting expensive sequential scans and cost bottlenecks.
