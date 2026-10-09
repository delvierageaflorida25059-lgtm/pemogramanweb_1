# Smart Restaurant Management System

Sistem manajemen restoran enterprise yang mengintegrasikan operasional restoran
ke dalam satu aplikasi: QR ordering, POS/Kasir, Kitchen Display, menu, dan
laporan penjualan.

**Stack:** HTML + CSS + Vanilla JavaScript (ES Module) · Node.js + Express.js ·
MariaDB/MySQL · Socket.IO · PWA

---

## Daftar Isi

1. [Fitur](#fitur)
2. [Kebutuhan Sistem](#kebutuhan-sistem)
3. [Cara Menjalankan](#cara-menjalankan)
4. [Akun Demo](#akun-demo)
5. [Alur Penggunaan](#alur-penggunaan)
6. [Struktur Project](#struktur-project)
7. [Dokumentasi API](#dokumentasi-api)
8. [Pengujian](#pengujian)
9. [Keamanan](#keamanan)
10. [Catatan Deviasi dari Blueprint](#catatan-deviasi-dari-blueprint)
11. [Pengembangan Selanjutnya](#pengembangan-selanjutnya)
12. [Troubleshooting](#troubleshooting)

---

## Fitur

### Sudah Diimplementasikan (Fase 1-3)

| Modul | Fitur |
|---|---|
| **Autentikasi** | Login, registrasi, JWT access + refresh token, ganti password |
| **RBAC** | 8 role, 25 permission, pembatasan akses di sisi server |
| **QR Ordering** | Pindai QR meja, pesan tanpa login, lacak status realtime |
| **POS / Kasir** | Transaksi meja atau take away, diskon, 4 metode pembayaran, cetak struk |
| **Payment** | CASH (dengan kembalian), QRIS, TRANSFER, CARD + refund penuh/sebagian |
| **Kitchen Display** | Papan pesanan 4 kolom, perubahan status dengan satu klik, realtime |
| **Manajemen Meja** | CRUD meja, terbitkan ulang QR, cetak semua QR |
| **Manajemen Menu** | Kategori, produk, varian, addon, tandai produk habis |
| **Manajemen User** | CRUD user, atur role, atur permission per role |
| **Laporan** | Dashboard harian, grafik penjualan per jam, produk terlaris, sebaran metode bayar |
| **Notifikasi** | Realtime via Socket.IO, tandai sudah dibaca |
| **Audit Log** | Mencatat aktivitas penting beserta IP dan user agent |
| **PWA** | Installable, offline untuk aset statis, shortcut aplikasi |

### Belum (Fase 4-6)

Inventory bahan baku, Recipe/BOM, Procurement, Finance lengkap, backup otomatis.
Rancangnya ada di [`docs/`](docs/).

---

## Kebutuhan Sistem

| Software | Versi | Keterangan |
|---|---|---|
| **Node.js** | 18 atau lebih baru | Sudah diuji pada v24 |
| **MySQL** | 8.0 **atau** MariaDB 10.4 | Skema ditulis kompatibel keduanya |
| **Browser** | Chrome/Edge/Firefox/Safari versi modern | Butuh dukungan ES Module |

> **Soal database:** blueprint menyebut MySQL 8. Diagrams ini memakai **MariaDB
> 10.4 dari XAMPP** karena MySQL 8 tidak tersedia pada mesin pengembangan.
> `database/schema.sql` sengaja ditulis agar jalan di keduanya.

---

## Cara Menjalankan

### 1. Nyalakan Database

**XAMPP:**

```bash
# Buka XAMPP Control Panel, lalu klik Start pada MySQL
# Atau lewat terminal:
C:\xampp\mysql\bin\mysqld.exe --defaults-file=C:\xampp\mysql\bin\my.ini
```

**MySQL 8 (service):**

```bash
net start MySQL80
```

### 2. Siapkan Konfigurasi

```bash
# Windows PowerShell
Copy-Item .env.example .env

# Linux / macOS
cp .env.example .env
```

Buka `.env` lalu sesuaikan. Untuk XAMPP, nilai bawaan biasanya sudah benar:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=restaurant_management
```

> **Ganti JWT secret sebelum dipakai di produksi:**
> ```bash
> node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
> ```

### 3. Pasang Dependency

```bash
npm install
```

### 4. Siapkan Database

```bash
npm run migrate
npm run seed
```

- `migrate` membuat 20 tabel. **Perintah ini menghapus database lama.**
- `seed` mengisi role, permission, 4 akun demo, 4 kategori, 14 produk,
  9 addon, dan 10 meja beserta QR code.

### 5. Jalankan Aplikasi

```bash
npm start
```

Buka **http://localhost:3000**

### Ringkasan Perintah

| Perintah | Kegunaan |
|---|---|
| `npm start` | Menjalankan server |
| `npm run dev` | Server dengan auto-reload (`node --watch`) |
| `npm run migrate` | Membuat tabel (menghapus DB lama) |
| `npm run migrate -- --force` | Sama, tanpa tanya konfirmasi |
| `npm run seed` | Mengisi data awal (aman diulang) |
| `npm run reset` | migrate --force + seed |
| `npm test` | Unit test (tanpa server) |
| `npm run test:e2e` | Integration test (perlu server aktif) |
| `npm run lint` | Pemeriksaan kode dan secret |
| `npm run icons` | Membuat ulang ikon PWA |

---

## Akun Demo

| Peran | Email | Password | Halaman Utama |
|---|---|---|---|
| Admin | `admin@restaurant.test` | `Admin123!` | Dashboard |
| Manager | `manager@restaurant.test` | `Manager123!` | Dashboard |
| Kasir | `cashier@restaurant.test` | `Cashier123!` | Kasir / POS |
| Dapur | `kitchen@restaurant.test` | `Kitchen123!` | Kitchen Display |

> Password di atas hanya untuk pengembangan. **Ganti sebelum deploy.**

---

## Alur Penggunaan

### Alur 1 - Customer Memesan lewat QR

```text
1. Pelanggan memindai QR di meja
2. Browser membuka /menu.html?token=xxx
3. Server memvalidasi token dan menampilkan menu
4. Pelanggan memilih produk, varian, dan addon
5. Pelanggan menekan "Kirim Pesanan"
6. Order masuk ke papan dapur secara realtime
7. Pelanggan diarahkan ke halaman lacak pesanan
8. Dapur mengubah status: Diterima → Dimasak → Siap → Selesai
9. Pelanggan melihat perubahan status secara realtime
```

> **Penting untuk demo:** `PUBLIC_BASE_URL` di `.env` menentukan isi QR.
> Nilai bawaannya `http://localhost:3000`, yang hanya bisa dipindai di
> komputer itu sendiri. Untuk mencoba dari ponsel, ganti dengan IP LAN
> komputer Anda, misalnya `http://192.168.1.10:3000`.

### Alur 2 - Kasir Mencatat Transaksi

```text
1. Kasir login di /cashier.html
2. Pilih meja (atau biarkan kosong untuk take away)
3. Klik produk untuk menambah ke keranjang
4. Opsional: isi diskon dalam persen
5. Tekan "Bayar", pilih metode, konfirmasi
6. Struk tampil, bisa langsung dicetak
7. Dapur otomatis melihat order baru
```

### Alur 3 - Refund

```text
1. Buka /admin-payments.html (butuh role MANAGER/ADMIN)
2. Pilih tanggal, cari pembayaran
3. Tekan "Refund", isi nominal dan alasan
4. Refund penuh otomatis membatalkan order
```

### Alur 4 - Terbitkan QR Meja

```text
1. Buka /admin-tables.html
2. Tab "QR Codes" menampilkan QR untuk setiap meja
3. Klik "Cetak Semua" untuk mencetak
4. "Terbitkan Ulang" mengganti token bila QR rusak atau hilang
```

---

## Struktur Project

```text
smart-restaurant-management/
├── backend/
│   ├── server.js              Bootstrap HTTP + Socket.IO + graceful shutdown
│   ├── app.js                 Konfigurasi Express (bisa di-import test)
│   ├── config/
│   │   ├── env.js             Validasi environment variable
│   │   ├── database.js        Pool mysql2, query, withTransaction
│   │   └── socket.js          Instance Socket.IO + helper emit
│   ├── middleware/
│   │   ├── auth.js            requireAuth, optionalAuth
│   │   ├── rbac.js            requirePermission, requireRole
│   │   ├── validate.js        (di validators/)
│   │   ├── rateLimit.js       Rate limit global dan khusus login
│   │   ├── audit.js           Audit log
│   │   ├── errorHandler.js    Penanganan error terpusat
│   │   └── asyncHandler.js    Penangkap rejection Express 4
│   ├── controllers/           10 controller (tipis)
│   ├── services/              12 service (seluruh logika bisnis)
│   ├── routes/                10 berkas route
│   └── utils/
│       ├── ApiError.js        Kelas error terstruktur
│       ├── money.js           Perhitungan uang
│       ├── token.js           JWT
│       ├── response.js        Bentuk JSON konsisten
│       └── validators/        Validator ringan
│
├── frontend/
│   ├── *.html                 13 halaman
│   ├── css/style.css          Stylesheet tunggal
│   ├── js/                    12 modul ES
│   ├── assets/                Ikon PWA
│   ├── manifest.json
│   └── sw.js                  Service worker
│
├── database/
│   ├── schema.sql             20 tabel
│   ├── migrate.js             Runner migrasi
│   └── seed.js                Data awal
│
├── tests/
│   ├── unit/                  money, rbac (28 test)
│   └── integration/           e2e, smoke-pages (35 test)
│
├── docs/                      11 diagram Mermaid
├── scripts/
│   ├── generate-icons.js      Pembuat ikon PWA
│   └── lint.js                Lint tanpa dependency
│
├── package.json
├── .env.example
└── README.md
```

---

## Dokumentasi API

Semua respons memakai bentuk yang konsisten:

```json
// Berhasil
{ "success": true, "message": "Berhasil.", "data": { }, "meta": { } }

// Gagal
{ "success": false, "message": "Pesan error.", "code": "ERROR_CODE", "errors": { } }
```

### Authentication

| Method | Endpoint | Keterangan |
|---|---|---|
| POST | `/api/auth/login` | Publik, rate limit ketat |
| POST | `/api/auth/register` | Publik, hanya membuat role CUSTOMER |
| POST | `/api/auth/refresh` | Tukar refresh token |
| POST | `/api/auth/logout` | Cabut refresh token |
| GET | `/api/auth/me` | Profil user |
| PUT | `/api/auth/password` | Ganti password |

### Menu Publik

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/api/menu/categories` | Kategori aktif |
| GET | `/api/menu/products` | Produk, bisa filter kategori & pencarian |

### Meja & QR

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/api/tables/public/resolve?token=` | **Publik** - dipanggil setelah scan QR |
| GET | `/api/tables` | Daftar meja |
| POST | `/api/tables` | Buat meja (QR otomatis terbit) |
| PUT | `/api/tables/:id` | Ubah meja |
| DELETE | `/api/tables/:id` | Hapus meja |
| POST | `/api/tables/:id/qr` | Terbitkan ulang QR |
| GET | `/api/tables/qr/list` | Semua QR aktif |
| GET | `/api/tables/:id/qr.png` | Gambar QR (PNG) |

### Order

| Method | Endpoint | Keterangan |
|---|---|---|
| POST | `/api/orders` | **Publik** - QR (tamu) maupun POS (staff) |
| GET | `/api/orders` | Daftar order, dengan filter |
| GET | `/api/orders/:id` | Detail order |
| GET | `/api/orders/track/:orderNumber` | **Publik** - lacak status |
| GET | `/api/orders/table/:tableId/active` | Order aktif di meja |
| PATCH | `/api/orders/:id/status` | Ubah status |
| POST | `/api/orders/:id/cancel` | Batalkan (void) |

### Payment

| Method | Endpoint | Keterangan |
|---|---|---|
| POST | `/api/payments` | Catat pembayaran |
| GET | `/api/payments` | Riwayat pembayaran |
| GET | `/api/payments/:id` | Detail pembayaran |
| POST | `/api/payments/refund` | Proses refund |

### Kitchen, Menu, Admin

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/api/kitchen/board` | Papan dapur |
| PATCH | `/api/kitchen/orders/:id/status` | Majukan status |
| GET/POST/PUT/DELETE | `/api/categories[/:id]` | CRUD kategori |
| GET/POST/PUT/DELETE | `/api/products[/:id]` | CRUD produk |
| POST/PUT/DELETE | `/api/products/:id/variants[/:variantId]` | Varian |
| POST/PUT/DELETE | `/api/products/:id/addons[/:addonId]` | Addon |
| GET/POST/PUT/DELETE | `/api/users[/:id]` | CRUD user |
| GET | `/api/users/roles/list` | Daftar role |
| GET | `/api/users/roles/permissions` | Permission per modul |
| PUT | `/api/users/roles/:id/permissions` | Atur permission role |

### Dashboard & Notifikasi

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/api/dashboard/summary` | Ringkasan hari ini |
| GET | `/api/dashboard/daily?date=` | Ringkasan tanggal tertentu |
| GET | `/api/notifications` | Daftar notifikasi |
| PATCH | `/api/notifications/:id/read` | Tandai dibaca |

### Health Check

```http
GET /health
```

---

## Pengujian

```bash
npm test           # Unit test (28 test, tanpa server)
npm run test:e2e   # Integration test (35 test, perlu server aktif)
npm run lint       # Lint + pemeriksaan secret
```

Untuk test integrasi, server harus berjalan lebih dulu:

```bash
npm start                    # Terminal 1
npm run test:e2e             # Terminal 2
```

### Cakupan Test

| Berkas | Jumlah | Menguji |
|---|:-:|---|
| `unit/money.test.js` | 20 | Pembulatan, kalkulasi total, pajak, kembalian |
| `unit/rbac.test.js` | 8 | HasPermission, bypass ADMIN, tanpa wildcard |
| `integration/e2e.test.js` | 27 | Seluruh alur bisnis dan keamanan |
| `integration/smoke-pages.test.js` | 8 | Halaman, aset, manifest, service worker |

Test integrasi mencakup skenario keamanan penting:

- Harga yang dimanipulasi dari client diabaikan server
- Diskon hanya berlaku untuk staff, bukan tamu
- Varian dan addon dari produk lain ditolak
- Lompatan status pesanan ditolak
- Role tanpa izin benar-benar ditolak (403)
- Pembayaran melebihi sisa tagihan ditolak
- Kembalian hanya untuk metode CASH

---

## Keamanan

| Aspek | Implementasi |
|---|---|
| Password | bcryptjs, minimal 8 karakter |
| Token | JWT access (15 menit) + refresh (7 hari) dengan rotasi |
| Refresh token | Disimpan sebagai hash SHA-256, bukan mentah |
| Timing attack | Login gagal tetap membandingkan hash palsu |
| SQL Injection | 100% parameterized query |
| XSS | Setiap nilai dari server dibungkus `escapeHtml()` |
| Otorisasi | RBAC di server, bukan hanya menyembunyikan tombol |
| Rate limit | Global + ketat khusus login |
| CORS | Whitelist origin |
| Audit log | Aktivitas penting + IP + user agent |
| Input validation | Skema per route, pesan error per field |

### Catatan Penting

- **Harga selalu dihitung ulang di server.** Nilai harga dari browser diabaikan.
- **RBAC ditegakkan di backend.** Menyembunyikan tombol di frontend bukan
  mekanisme keamanan, hanya kenyamanan.
- **Endpoint `/api` tidak pernah di-cache** oleh service worker, agar kasir tidak
  pernah melihat data pembayaran lama saat koneksi putus.

---

## Catatan Deviasi dari Blueprint

Bagian ini penting untuk dilaporkan alongside tugas.

| Aspek | Blueprint | Implementasi | Alasan |
|---|---|---|---|
| Database | MySQL 8 | MariaDB 10.4 | MySQL 8 tidak terinstal |
| Driver password | `bcrypt` | `bcryptjs` | `bcrypt` native gagal build di Windows tanpa Visual Studio |
| Container | `docker-compose.yml` | Tidak disertakan | Docker tidak terinstal |
| Payment | Integrasi gateway | Simulasi | Butuh akun dan kredensial berbayar |
| QR code | Render di frontend | Render di server | Algoritma QR yang ditulis sendiri rawan bug |
| Validator | File per entity | Satu modul + skema inline | Lebih ringkas dan mudah dibaca |
| Test | Tidak diminta | Ditambahkan | Menangkap 3 bug sebelum selesai |

### Bug yang Ditangkap oleh Pengujian

Pengujian menemukan tiga masalah nyata yang tanpa test akan lolos ke produksi:

1. **Request menggantung selamanya.** Express 4 tidak menangkap error dari
   handler `async`. Setiap kegagalan login membuat request hang tanpa batas.
   Diperbaiki dengan `wrapRouter()` di `backend/utils/asyncHandler.js`.
2. **Refresh token bentrok.** Dua login dalam detik menghasilkan JWT yang
   identik sehingga hash-nya violate unique constraint. Diperbaiki dengan
   menambahkan `jti` acak pada payload.
3. **Seluruh validasi mengembalikan 500.** `ApiError` diimpor dengan
   destructuring padahal diekspor sebagai class langsung, sehingga bernilai
   `undefined`.

Ditambah satu bug XSS di frontend: nama addon disisipkan ke `innerHTML`
tanpa `escapeHtml()`.

---

## Pengembangan Selanjutnya

### Fase 4 - Inventory

Prioritas: tabel `ingredients`, `recipes`, `recipe_items`,
`inventory_transactions`, `stock_opnames`, dan pengurangan stok otomatis saat
produk terjual. Rancangan tersedia di
[`docs/07-sequence-inventory-deduction.md`](docs/07-sequence-inventory-deduction.md).

### Fase 5 - Procurement

Tabel `suppliers`, `purchase_requests`, `purchase_orders`, `goods_receipts`.
Rancangan di
[`docs/04-activity-procurement.md`](docs/04-activity-procurement.md).

### Fase 6 - Finance

Tabel `expenses`, `cash_transactions`, `daily_reports`, dan laporan laba rugi.

### Integrasi Payment Gateway

Struktur data sudah disiapkan (`reference`, `status` termasuk `PENDING`).
Yang perlu ditambahkan: verifikasi signature webhook dan idempotency key.

---

## Troubleshooting

### Server tidak bisa terhubung ke database

```text
Gagal terhubung ke database: connect ECONNREFUSED 127.0.0.1:3306
```

1. Pastikan MySQL/MariaDB sudah jalan
2. Cek `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` di `.env`
3. Untuk XAMPP, buka Control Panel dan klik **Start** pada MySQL

### Port 3000 sudah dipakai

```text
Error: listen EADDRINUSE: address already in use :::3000
```

Ganti `PORT` di `.env`, atau hentikan proses yang memakai port tersebut:

```powershell
$conn = Get-NetTCPConnection -LocalPort 3000 -State Listen
Stop-Process -Id $conn.OwningProcess -Force
```

### Halaman menampilkan "Akses ditolak"

Tombol disembunyikan di antarmuka, tetapi itu bukan pengaman. Permission dibaca
ulang dari database pada setiap request, jadi pembatasan nyata ada di server.
Pastikan akun Anda sudah punya role yang benar.

### QR tidak bisa dipindai

1. Cek `PUBLIC_BASE_URL` di `.env`
2. Pastikan perangkat ponsel berada di jaringan yang sama dengan server
3. Uji dengan membuka URL QR langsung di browser
4. Bila berubah, gunakan tombol "Terbitkan Ulang"

### Login lambat sekali

Normal. bcrypt dengan cost 10 memang sengaja lambat demi keamanan.

### Menu tidak berubah setelah edit produk

Hard refresh dengan `Ctrl+F5`. Service worker mungkin masih menyimpan versi
lama. Naikkan `VERSION` di `frontend/sw.js` bila ingin memaksa pembaruan.

### Ingin memulai dari awal

```bash
npm run reset
```

---

## Lisensi

MIT