# Sequence Diagram - Customer Order (QR)

Alur lengkap dari pelanggan memindai QR hingga pesanan tercatat di dapur.
Berfokus pada interaksi antara browser, API Express, service, dan MySQL.

## Diagram

```mermaid
sequenceDiagram
    autonumber
    actor P as Pelanggan
    participant B as Browser (menu.js / cart.js)
    participant R as Express Router
    participant OA as order.controller
    participant OS as order.service
    participant TS as table.service
    participant PS as product.service
    participant DB as MySQL
    participant SK as Socket.IO

    P->>B: Memindai QR Code di meja
    B->>R: GET /api/tables/public/resolve?token=xxx
    R->>TS: resolveToken(token)
    TS->>DB: SELECT ... FROM table_qr_codes JOIN restaurant_tables
    DB-->>TS: Data meja
    TS->>DB: UPDATE table_qr_codes SET scan_count = scan_count + 1
    TS-->>R: { table, qrToken }
    R-->>B: 200 OK
    B-->>P: Tampilkan menu untuk meja tersebut

    P->>B: Memilih produk, varian, dan addon
    B->>B: Simpan ke keranjang di localStorage
    Note over B: Harga di layar hanyalah perkiraan.<br/>Yang menentukan adalah harga di server.

    P->>B: Tekan "Kirim Pesanan"
    B->>R: POST /api/orders (tanpa token auth)

    R->>R: rateLimit + audit middleware
    R->>R: optionalAuth (tamu tidak perlu login)
    R->>R: validate(body)

    R->>OA: create(req, res)
    OA->>OS: create(payload, user=null)

    OS->>TS: resolveTable(token)
    TS-->>OS: { id: 1, code: "A01" }

    OS->>PS: findByIds([3, 7, 9])
    PS->>DB: SELECT * FROM products WHERE id IN (3,7,9)
    DB-->>PS: Data produk beserta harga terbaru
    PS-->>OS: Map harga resmi

    OS->>OS: prepareItems() - validasi varian & addon
    OS->>OS: calculateOrderTotals() - subtotal, pajak, service, total

    OS->>DB: BEGIN TRANSACTION
    OS->>DB: INSERT INTO orders (order_number sementara, status PENDING)
    DB-->>OS: insertId = 42
    OS->>DB: UPDATE orders SET order_number = 'ORD-20261008-00042'
    OS->>DB: INSERT INTO order_items (3 baris)
    OS->>DB: INSERT INTO order_item_addons (2 baris)
    OS->>DB: INSERT INTO order_status_history (PENDING)
    OS->>DB: UPDATE restaurant_tables SET status = 'OCCUPIED'
    OS->>DB: COMMIT

    OS->>DB: SELECT order lengkap dengan item
    DB-->>OS: Data order lengkap

    OS->>SK: emitTo('kitchen', 'order:new', order)
    SK-->>D: Papan dapur menampilkan pesanan baru

    OS-->>OA: order
    OA->>OA: setAudit(res, { action: 'CREATE', ... })
    OA-->>B: 201 Created + JSON order

    B-->>P: Redirect ke halaman lacak pesanan
```

## Catatan Penting

### Harga Tidak Pernah Dipercaya dari Client

Payload yang dikirim frontend hanya berisi `product_id`, `variant_id`, `quantity`,
dan `addons`. **Tidak ada `price` di dalamnya.** `order.service.prepareItems()`
mengambil harga dari `product.service.findByIds()` setiap kali order dibuat.

Kalau ada yang mencoba mengirim `price: 1`, nilai tersebut diabaikan begitu saja.

### Satu Transaksi Database

Seluruh pembuatan order dibungkus `withTransaction()`:

```js
return withTransaction(async (conn) => {
  // insert order
  // update order_number
  // insert order_items
  // insert order_item_addons
  // insert order_status_history
  // update table status
});
```

Bila salah satu query gagal, `rollback()` dijalankan sehingga tidak ada order
tanpa item atau item tanpa order.

### Nomor Order Anti Tabrakan

`order_number` berisi format `ORD-YYYYMMDD-00042` yang bergantung pada `id`.
Masalahnya, `id` baru diketahui setelah insert. Solusinya:

1. Insert dengan `order_number` sementara yang pasti unik (timestamp acak)
2. Update dengan nomor permanen berdasarkan `id` yang baru didapat

Cara ini bebas race condition, berbeda dengan pola `SELECT MAX(id) + 1`.

### Event Realtime

Setelah transaksi commit, service memancarkan event ke Socket.IO:

| Event | Ruang | Ditonton oleh |
|---|---|---|
| `order:new` | `kitchen` | Papan dapur, kasir |
| `order:new` | `table:A01` | Halaman menu meja tersebut |
| `notification:new` | semua koneksi | Notifikasi bell di halaman staff |

### Error yang Mungkin Terjadi

| Situasi | HTTP | Pesan |
|---|:-:|---|
| Token QR tidak valid | 400 | "QR meja tidak valid atau sudah dicabut." |
| Produk tidak ditemukan | 400 | "Produk #99 tidak ditemukan." |
| Produk sedang habis | 400 | "Produk '...' sedang kosong." |
| Varian bukan milik produk | 400 | "Varian yang dipilih tidak tersedia untuk produk ini." |
| Addon bukan milik produk | 400 | "Addon '...' tidak bisa dipilih untuk produk '...'." |
| Keranjang kosong | 400 | "Keranjang masih kosong." |
| Total tidak wajar | 400 | "Total order harus lebih besar dari nol." |