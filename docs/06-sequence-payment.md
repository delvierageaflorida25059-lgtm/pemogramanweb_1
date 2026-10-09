# Sequence Diagram - Payment (Simulasi)

Alur pencatatan pembayaran, validasi nominal, dan pembaruan status order.
Pada Fase 1-3 modul ini **bersifat simulasi** - tidak memanggil payment
gateway. Bentuk datanya sudah disiapkan agar integrasi gateway nanti tidak
mengubah skema tabel.

## Diagram: Pembayaran Berhasil

```mermaid
sequenceDiagram
    autonumber
    actor K as Kasir
    participant B as Browser (cashier.js)
    participant R as Express Router
    participant PA as payment.controller
    participant PS as payment.service
    participant OS as order.service
    participant DB as MySQL
    participant SK as Socket.IO
    participant D as Dapur

    K->>B: Melanjutkan pembayaran order
    B->>R: POST /api/payments
    R->>R: requireAuth
    R->>R: requirePermission('payment.create')
    R->>R: validate(order_id, method, amount, tender)
    R->>PA: create(req, res)
    PA->>PS: create(payload, user)

    PS->>DB: BEGIN TRANSACTION

    Note over PS,DB: SELECT ... FOR UPDATE<br/>Mengunci baris order supaya<br/>dua kasir tidak bisa membayar<br/>order yang sama sekaligus.

    PS->>DB: SELECT * FROM orders WHERE id = ? FOR UPDATE
    DB-->>PS: order (total, paid_amount, status)

    PS->>PS: Hitung sisa tagihan = total - paid_amount
    PS->>PS: Validasi nominal tidak melebihi sisa
    PS->>PS: Hitung kembalian (hanya untuk CASH)

    alt Metode CASH
        PS->>PS: tender >= amount
        Note over PS: Bila uang kurang, tolak dengan 400
    else Metode QRIS / TRANSFER / CARD
        PS->>PS: tender harus kosong
        Note over PS: Kembalian hanya mungkin untuk CASH
    end

    PS->>DB: INSERT INTO payments (status SUCCESS)
    DB-->>PS: paymentId = 88

    PS->>DB: UPDATE orders SET paid_amount = ?
    PS->>DB: BEGIN

    alt Order lunas dan masih PENDING
        PS->>DB: UPDATE orders SET status = 'CONFIRMED'
        PS->>DB: INSERT INTO order_status_history
    end

    PS->>DB: COMMIT

    PS->>OS: findById(orderId)
    OS->>DB: SELECT order + items + payments + history
    DB-->>OS: Data order terbaru
    OS-->>PS: order

    PS->>SK: emitTo('kitchen', 'order:updated', order)
    PS->>SK: emitTo('order:42', 'payment:success', {...})
    SK-->>D: Papan dapur melihat order CONFIRMED
    PS->>SK: emitTo('dashboard', 'payment:created', {...})

    PS-->>PA: { payment, order, change, isFullyPaid }
    PA-->>B: 201 Created
    B-->>K: Tampilkan struk
```

## Diagram: Refund

```mermaid
sequenceDiagram
    autonumber
    actor M as Manajer
    participant B as Browser (admin-payments.js)
    participant R as Express Router
    participant PA as payment.controller
    participant PS as payment.service
    participant DB as MySQL
    participant AL as audit_logs

    M->>B: Membuka dialog refund
    B->>R: POST /api/payments/refund
    R->>R: requireAuth
    R->>R: requirePermission('payment.refund')
    Note over R: Kasir biasa TIDAK punya izin ini.<br/>Hanya MANAGER, ADMIN, dan OWNER.
    R->>PA: refund(req, res)
    PA->>PS: refund(payload, user)

    PS->>DB: BEGIN TRANSACTION

    PS->>DB: SELECT * FROM payments WHERE id = ? FOR UPDATE
    DB-->>PS: payment (amount, refunded_amount, status)

    PS->>PS: Validasi belum direfund seluruhnya
    PS->>PS: Hitung sisa yang bisa direfund
    PS->>PS: Validasi nominal tidak melebihi sisa

    alt Refund penuh
        PS->>DB: UPDATE payments SET refunded_amount=?, status='REFUNDED'
    else Refund sebagian
        PS->>DB: UPDATE payments SET refunded_amount=?, status='PARTIAL_REFUND'
    end

    PS->>DB: SELECT * FROM orders WHERE id = ? FOR UPDATE
    DB-->>PS: order (total, paid_amount, status)

    PS->>PS: paid_amount baru = paid_amount lama - nominal refund
    PS->>DB: UPDATE orders SET paid_amount = ?

    alt paid_amount menjadi 0 dan order belum selesai
        PS->>DB: UPDATE orders SET status='CANCELLED', cancelled_at=NOW()
        PS->>DB: INSERT INTO order_status_history
        Note over PS,DB: Order dibatalkan otomatis agar<br/>tidak ada tagihan menggantung.
    end

    PS->>AL: INSERT INTO audit_logs (action='REFUND')
    PS->>DB: COMMIT

    PS-->>PA: { refundedAmount, orderCancelled, order }
    PA-->>B: 200 OK
    B-->>M: Tampilkan hasil refund
```

## Peran Fase 1-3: Simulasi, Bukan Gateway

| Yang Sudah Ada | Yang Belum (Perlu Saat Integrasi) |
|---|---|
| Kolom `method` untuk 4 metode | Verifikasi signature webhook provider |
| Kolom `reference` untuk id transaksi provider | Idempotency key agar webhook dobel tidak dikreditkan |
| Kolom `status` termasuk `PENDING` | Alur create -> webhook konfirmasi |
| Riwayat refund per baris | Pengembalian dana otomatis ke customer |
| Validasi nominal di server | Rekonsiliasi mutasi bank |

Kolom sudah disiapkan sekarang supaya integrasi gateway nanti cukup menambah
layer verifikasi, **tanpa mengubah skema tabel**.

## Metode Pembayaran

| Method | Kembalian | Verifikasi | Catatan |
|---|:-:|:-:|---|
| `CASH` | Ya | Langsung | Kembalian dihitung dari `tender - amount` |
| `QRIS` | Tidak | Simulasi | Dicatat sebagai SUCCESS langsung |
| `TRANSFER` | Tidak | Simulasi | Referensi transaksi dicatat manual |
| `CARD` | Tidak | Simulasi | Dicatat sebagai SUCCESS langsung |

## Status Pembayaran

```text
PENDING -> SUCCESS -> PARTIAL_REFUND -> REFUNDED
                    \-> REFUNDED
                    \-> FAILED
```

| Status | Arti |
|---|---|
| `PENDING` | Menunggu konfirmasi (belum dipakai di Fase 1-3) |
| `SUCCESS` | Pembayaran diterima |
| `PARTIAL_REFUND` | Sudah direfund sebagian |
| `REFUNDED` | Sudah direfund seluruhnya |
| `FAILED` | Gagal (disiapkan untuk integrasi gateway) |

## Aturan Penting

1. **Tidak ada pembayaran melebihi sisa tagihan.** Server menolak dengan 400.
2. **CASH boleh punya kembalian, selain itu tidak.** Mengirim `tender` dengan
   metode non-CASH akan ditolak.
3. **Order lunas otomatis menjadi CONFIRMED.** Menghemat langkah kasir.
4. **Order dengan `paid_amount` 0 otomatis dibatalkan saat refund penuh.**
5. **Semua refund tercatat di `audit_logs`**, termasuk alasan refund.
