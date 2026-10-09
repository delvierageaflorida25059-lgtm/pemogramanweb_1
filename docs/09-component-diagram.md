# Component Diagram - Smart Restaurant Management System

Gambaran modul penyusun sistem beserta dependensi antar modul.

## Arsitektur Lapisan

```text
┌───────────────────────────────────────────────────────────────┐
│ PRESENTASI - Frontend (HTML + CSS + Vanilla JS / PWA)         │
│                                                               │
│  Halaman HTML (13)  │  api.js  ui.js  store.js                │
│  index / login      │  socket.js  qr.js  pwa.js               │
│  menu / cart / order│                                         │
│  cashier / kitchen  │                                         │
│  dashboard / admin-*│                                         │
└───────────────────────────┬───────────────────────────────────┘
                            │ REST (fetch) + Socket.IO
┌───────────────────────────▼───────────────────────────────────┐
│ TRANSPORT - Express.js                                        │
│                                                               │
│  MIDDLEWARE: cors → json → security header → rateLimit         │
│              → audit → validate → auth → rbac                  │
│                                                               │
│  ROUTES → CONTROLLERS → SERVICES → DATABASE                    │
└───────────────────────────┬───────────────────────────────────┘
                            │ mysql2 (parameterized query)
┌───────────────────────────▼───────────────────────────────────┐
│ DATA - MariaDB 10.4 / MySQL 8                                  │
│  RBAC(6) │ Menu(4) │ Meja+QR(2) │ Order(5) │ Lain(3)         │
│  Total 20 tabel                                                │
└───────────────────────────────────────────────────────────────┘
```

## Diagram Komponen

```mermaid
flowchart TB
    subgraph FE["FRONTEND"]
        FE_PAGE["Halaman HTML"]
        FE_API["api.js"]
        FE_UI["ui.js"]
        FE_STORE["store.js"]
        FE_SOCKET["socket.js"]
        FE_QR["qr.js"]
        FE_PWA["pwa.js"]
    end

    subgraph MW["MIDDLEWARE"]
        MW_RATE["rateLimit.js"]
        MW_AUDIT["audit.js"]
        MW_VALID["validators"]
        MW_AUTH["auth.js"]
        MW_RBAC["rbac.js"]
        MW_ERR["errorHandler.js"]
    end

    subgraph ROUTES["ROUTES"]
        R_AUTH["auth"]
        R_USER["user"]
        R_MENU["menu"]
        R_CAT["category"]
        R_PROD["product"]
        R_TABLE["table"]
        R_ORDER["order"]
        R_PAY["payment"]
        R_KITCH["kitchen"]
        R_MISC["notif + dashboard"]
    end

    subgraph SVC["SERVICES"]
        S_AUTH["auth.service"]
        S_USER["user.service"]
        S_CAT["category.service"]
        S_PROD["product.service"]
        S_TABLE["table.service"]
        S_QR["qr.service"]
        S_ORDER["order.service"]
        S_PAY["payment.service"]
        S_KITCH["kitchen.service"]
        S_NOTIF["notification.service"]
        S_DASH["dashboard.service"]
    end

    subgraph UTIL["UTILITIES"]
        U_ERR["ApiError"]
        U_MONEY["money.js"]
        U_TOKEN["token.js"]
        U_RESP["response.js"]
        U_ASYNC["asyncHandler.js"]
    end

    subgraph CFG["CONFIG"]
        C_ENV["config/env.js"]
        C_DB["config/database.js"]
        C_SOCK["config/socket.js"]
    end

    DB[("MySQL / MariaDB<br/>20 tabel")]

    %% Client
    FE_PAGE --> FE_API
    FE_PAGE --> FE_STORE
    FE_PAGE --> FE_QR
    FE_PAGE --> FE_PWA
    FE_API -.-> FE_SOCKET

    %% Urutan middleware
    FE_API --> MW_RATE
    MW_RATE --> MW_AUDIT
    MW_AUDIT --> MW_VALID
    MW_VALID --> MW_AUTH
    MW_AUTH --> MW_RBAC
    MW_RBAC --> MW_ERR

    %% Route ke service
    R_AUTH --> S_AUTH
    R_USER --> S_USER
    R_MENU --> S_CAT
    R_MENU --> S_PROD
    R_CAT --> S_CAT
    R_PROD --> S_PROD
    R_TABLE --> S_TABLE
    R_TABLE --> S_QR
    R_ORDER --> S_ORDER
    R_PAY --> S_PAY
    R_KITCH --> S_KITCH
    R_MISC --> S_DASH
    R_MISC --> S_NOTIF

    %% Service saling memakai
    S_AUTH --> S_USER
    S_ORDER --> S_TABLE
    S_ORDER --> S_PROD
    S_ORDER --> S_PAY
    S_ORDER --> S_NOTIF
    S_PAY --> S_ORDER
    S_KITCH --> S_ORDER
    S_TABLE --> S_QR

    %% Service ke utilitas
    S_ORDER --> U_MONEY
    S_PAY --> U_MONEY
    S_PROD --> U_MONEY
    S_TABLE --> U_MONEY
    S_AUTH --> U_TOKEN
    S_AUTH --> S_USER
    S_ORDER --> U_ERR
    S_PAY --> U_ERR
    S_USER --> U_ERR
    U_TOKEN --> U_ERR
    U_MONEY --> U_RESP

    %% Service ke config dan database
    S_AUTH --> C_DB
    S_USER --> C_DB
    S_ORDER --> C_DB
    S_PAY --> C_DB
    S_DASH --> C_DB
    C_DB --> DB
    C_DB --> C_ENV

    %% Realtime
    S_ORDER --> C_SOCK
    S_PAY --> C_SOCK
    S_NOTIF --> C_SOCK
    C_SOCK -.-> FE_SOCKET
```

## Tanggung Jawab Komponen

### Frontend

| Komponen | Tanggung Jawab |
|---|---|
| `api.js` | Menyisipkan header `Authorization`, membuka JSON, mencoba refresh token saat access token kedaluwarsa |
| `ui.js` | Toast, modal, konfirmasi, `escapeHtml`, format Rupiah, guard halaman |
| `store.js` | Keranjang di `localStorage` per meja, konversi ke payload order |
| `socket.js` | Koneksi realtime, auto-reconnect, join room |
| `qr.js` | Menampilkan gambar QR hasil render server |
| `pwa.js` | Registrasi service worker, prompt instalasi |

### Backend

| Layer | Tanggung Jawab |
|---|---|
| `config/env.js` | Membaca dan memvalidasi environment variable |
| `config/database.js` | Connection pool, `query`, `withTransaction` |
| `config/socket.js` | Menyimpan instance Socket.IO agar bisa dipakai service |
| `middleware/*` | Keamanan, validasi, audit, penanganan error |
| `routes/*` | Mendefinisikan URL, method, dan urutan middleware |
| `controllers/*` | Tipis: baca req, panggil service, kirim response |
| `services/*` | Seluruh logika bisnis dan query database |
| `utils/*` | Perhitungan uang, token, respons, error |

## Prinsip Dependency

Aturan yang dijaga agar kode tetap mudah dibaca:

1. **Controller tidak pernah menulis SQL.** Semua query ada di service.
2. **Service boleh memakai service lain**, tapi tidak boleh saling melingkar. Contoh:
   `order.service` memakai `product.service`, tetapi `product.service` tidak
   pernah memakai `order.service`.
3. **Route tidak boleh berisi logika bisnis**, hanya wiring.
4. **Utilitas tidak boleh tahu apa pun tentang database.**
5. **`errorHandler` dipasang paling akhir** di `app.js`.

## Library Eksternal

| Library | Dipakai Untuk | Alasan |
|---|---|---|
| `express` | Framework HTTP | Stabil dan sudah umum dipakai |
| `mysql2` | Driver database | Mendukung prepared statement |
| `bcryptjs` | Hash password | Pure JS, tidak butuh compiler native di Windows |
| `jsonwebtoken` | JWT | Standar de facto |
| `socket.io` | Realtime | Mendukung room, reconnect otomatis |
| `nanoid` | Token QR | Pendek, acak, aman |
| `qrcode` | Render QR PNG | Algoritma QR teruji, bukan ditulis sendiri |
| `express-rate-limit` | Rate limiting | Sudah teruji |
| `cors` | CORS | Standar |
| `dotenv` | Environment variable | Standar |
