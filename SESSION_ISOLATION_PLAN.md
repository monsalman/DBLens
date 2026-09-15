# DBLens — Session Isolation & Multi-Tenancy Implementation Plan

---

## 1. Problem Statement

Saat ini DBLens menyimpan semua profil koneksi ke satu file global di server (`/data/connections.json`). 

**Dampak Keamanan & User Experience**:
- Jika DBLens dideploy di server publik / VPS (misal: `http://database-dblens-xyz.sslip.io`), **User A** menambahkan database PostgreSQL pribadinya.
- Ketika **User B** membuka URL yang sama dari browser/laptop lain, **User B dapat melihat dan mengontrol seluruh database milik User A** karena backend membaca file server global yang sama.

---

## 2. Target Architecture: Stateless Proxy & Client Isolation

DBLens akan beroperasi menggunakan **Stateless Proxy Pattern** (mirip Adminer / phpMyAdmin):
1. **Zero Data on Server Disk**: Server DBLens tidak pernah menyimpan DSN/password database pengguna ke file disk server.
2. **Client-Side Profile Storage**: Kredensial & profil database disimpan 100% di browser pengguna (`localStorage`) menggunakan **Same-Origin Isolation Policy**.
3. **Stateless Request Execution**: Setiap request API membawa DSN / profile ID terenkripsi pada header `X-DBLENS-DSN`. Server hanya bertindak sebagai eksekutor query on-demand.
4. **Shared Server Profiles (Optional)**: Hanya koneksi dari environment variable server (`DBLENS_CONNECTIONS`) yang dapat dilihat oleh seluruh pengguna (Read-Only global connection).

---

## 3. Detailed Request & Data Flow

```
[ User A Browser (Laptop A) ]              [ User B Browser (Laptop B) ]
  LocalStorage:                             LocalStorage:
   - Profile A1: postgres://userA...         - Profile B1: mysql://userB...
  Request Header:                           Request Header:
   `X-DBLENS-DSN: postgres://userA...`       `X-DBLENS-DSN: mysql://userB...`
            │                                         │
            └────────────────────┬────────────────────┘
                                 │ HTTP REST API
                                 ▼
                     ┌──────────────────────┐
                     │ Go Backend Engine    │
                     │ (Stateless Proxy)    │
                     └───────────┬──────────┘
                                 │
              ┌──────────────────▼──────────────────┐
              │ Thread-Safe Connection Pool Registry│
              │ Key: SHA256(DSN) -> *sql.DB         │
              │ Auto-Evict Idle Pools > 10 Minutes │
              └─────────────────────────────────────┘
```

---

## 4. Implementation Steps

### Step 1: Frontend LocalStorage Migration (`web/src`)
- **`web/src/lib/api.ts`**:
  - `getProfiles()`: Read saved profiles from `localStorage.getItem('dblens-user-profiles')`. Also fetch global server-seeded profiles from `/api/profiles/global` if configured.
  - `addProfile()` & `updateProfile()` & `removeProfile()`: Perform CRUD directly on `localStorage`.
  - Pass header `X-DBLENS-DSN: <dsn>` on every database request (`getSchemas`, `getTables`, `getTableDetails`, `queryTableData`, `executeQuery`, `mutateRow`, `getERDData`).

### Step 2: Go Backend Router & Handler Refactoring
- **`internal/api/handlers.go`**:
  - Extract DSN from request header `X-DBLENS-DSN` (or query param).
  - Get or lazy-create driver instance for that DSN on-demand.
  - Remove server-side disk writing of user profiles (`connections.json`).
  - Keep `GET /api/profiles/global` only for environment variable `DBLENS_CONNECTIONS`.

### Step 3: On-Demand Connection Pool Registry
- **`internal/connection/manager.go`**:
  - Maintain `map[string]*ConnectionEntry` keyed by `SHA256(DSN)`.
  - On incoming request: get existing pool or open driver on-demand.
  - Background ticker cleaner: close and remove pools idle for > 10 minutes to save server RAM.

### Step 4: Verification & Security Testing
- Test with 2 isolated browser sessions (Incognito / CloakBrowser vs normal browser).
- Verify User A's connections NEVER leak to User B's session.
- Verify server disk has 0 sensitive credentials stored.
