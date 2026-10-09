# Sequence Diagram - Inventory Deduction (KONSEPTUAL - Fase 4)

> **STATUS: BELUM DIIMPLEMENTASIKAN**
>
> Pada Fase 1-3, penjualan produk **tidak** mengurangi stok bahan baku karena
> tabel `ingredients`, `recipes`, dan `recipe_items` belum ada. Yang sudah
> diimplementasikan hanyalah penandaan produk sebagai `AVAILABLE` /
> `UNAVAILABLE` secara manual.
>
> Diagram ini merancang mekanisme pengurangan stok otomatis yang akan dibangun
> di Fase 4.

## Kenapa Stok Bahan Perlu Recipe / BOM?

Stok produk jadi (Nasi Goreng) sebenarnya berasal dari beberapa bahan baku:

```text
Product: Nasi Goreng Spesial
    ├── Rice        = 150 gram
    ├── Egg         = 1 pcs
    ├── Chicken     = 50 gram
    ├── Cooking Oil = 10 ml
    └── Seasoning   = 5 gram
```

Tanpa relasi ini, sistem hanya tahu "Nasi Goreng terjual 3 porsi" dan tidak
Tahu berapa kilogram Rice yang seharusnya berkurang.

## Diagram Konseptual

```mermaid
sequenceDiagram
    autonumber
    actor S as Staff (Kasir / Dapur)
    participant B as Browser
    participant R as Express Router
    participant OS as order.service
    participant RS as recipe.service
    participant IS as inventory.service
    participant DB as MySQL
    participant SK as Socket.IO
    participant I as Staff Inventory

    S->>B: Pesanan lunas / order dikonfirmasi
    B->>R: PATCH /api/orders/:id/status
    R->>OS: changeStatus(orderId, 'CONFIRMED')
    OS->>DB: UPDATE orders SET status = 'CONFIRMED'

    Note over OS: Pengurangan stok dilakukan<br/>pada saat order dibuat (Fase 4)<br/>atau saat dikonfirmasi (Fase 5)<br/>, bukan saat status berubah.

    rect rgb(250, 247, 242)
    Note over OS,DB: FASE 4 - belum ada

    OS->>RS: getIngredientsForOrder(orderItems)
    RS->>DB: SELECT ri.*, i.name, i.stock, i.minimum_stock<br/>FROM recipe_items ri<br/>JOIN ingredients i ON i.id = ri.ingredient_id<br/>WHERE ri.product_id IN (...)
    DB-->>RS: Daftar bahan dan kebutuhan per porsi

    RS->>RS: Hitung total kebutuhan<br/>(jumlah porsi x takaran per porsi)
    Note over RS: Sisa bahan sebelumnya dari<br/>inventory_transactions

    loop Setiap bahan yang dibutuhkan
        OS->>IS: deductStock(ingredientId, quantityNeeded)

        IS->>DB: BEGIN TRANSACTION
        IS->>DB: SELECT stock FROM ingredients WHERE id = ? FOR UPDATE
        DB-->>IS: Stok saat ini

        alt Stok tidak mencukupi
            IS->>DB: ROLLBACK
            IS-->>OS: Error "Stok X tidak mencukupi"
        else Stok cukup
            IS->>DB: INSERT INTO inventory_transactions<br/>(type='SALE', quantity_out=?)
            IS->>DB: UPDATE ingredients SET stock = stock - ?
            IS->>DB: COMMIT
        end
    end

    OS->>DB: UPDATE orders SET status = 'CONFIRMED'

    OS->>IS: checkMinimumStock()
    IS->>DB: SELECT id, name, stock, minimum_stock<br/>FROM ingredients WHERE stock <= minimum_stock
    DB-->>IS: Bahan yang menipis

    loop Setiap bahan yang menipis
        IS->>SK: emitTo('inventory', 'stock:low', { ingredient })
        IS->>DB: INSERT INTO notifications (type='STOCK')
        SK-->>I: Notifikasi "Stok X menipis"
    end
    end
```

## Tabel yang Akan Dibutuhkan (Fase 4)

```text
ingredients
    id, name, code, unit (gram/ml/pcs),
    stock DECIMAL(12,3), minimum_stock DECIMAL(12,3),
    unit_price, supplier_id,
    status (ACTIVE/INACTIVE), created_at

recipes
    id, product_id, name,
    yield_quantity DECIMAL(12,3),
    note, created_at

recipe_items
    id, recipe_id, ingredient_id,
    quantity DECIMAL(12,3),
    unit, waste_percent DECIMAL(5,2) DEFAULT 0

inventory_transactions
    id, ingredient_id,
    type ENUM('PURCHASE','SALE','ADJUSTMENT','OPNAME','WASTE','VOID'),
    quantity_in DECIMAL(12,3),
    quantity_out DECIMAL(12,3),
    reference_type VARCHAR(30),
    reference_id BIGINT UNSIGNED,
    note VARCHAR(255),
    created_by BIGINT UNSIGNED,
    created_at

stock_opnames
    id, opname_number, status (DRAFT/APPROVED/CANCELLED),
    note, created_by, approved_by, created_at

stock_opname_items
    id, stock_opname_id, ingredient_id,
    system_stock, physical_stock, difference
```

## Perhitungan Waste

Masakan tidak pernah memakai 100% bahan. `waste_percent` di recipe_items
memambahkan penyangga:

```text
Kebutuhan riil   = quantity_resep x jumlah_porsi
KebutuhanEfektif = kebutuhan_riil x (1 + waste_percent / 100)

Contoh:
    Resep: Cooking Oil 10 ml per porsi
    Waste: 5%
    Terjual: 20 porsi

    Kebutuhan riil    = 10 x 20            = 200 ml
    Kebutuhan efektif  = 200 x (1 + 0.05)   = 210 ml
```

## Jenis Inventory Transaction

| Type | Arah | Kapan Terjadi |
|---|---|---|
| `PURCHASE` | Masuk | Barang diterima dari supplier (Fase 5) |
| `SALE` | Keluar | Produk terjual ke pelanggan |
| `ADJUSTMENT` | Masuk/Keluar | Penyesuaian manual oleh staff |
| `OPNAME` | Masuk/Keluar | Hasil hitung fisik |
| `WASTE` | Keluar | Bahan hilang/rusak |
| `VOID` | Balik | Pembatalan order mengembalikan stok |

## Kendala yang Harus Diperhatikan

| Kendala | Solusi |
|---|---|
| Dua kasir menjual bahan yang sama bersamaan | `SELECT ... FOR UPDATE` pada baris `ingredients` |
| Order dibatalkan setelah stok berkurang | Tipe `VOID` mengembalikan jumlah stok |
| Resep diubah setelah produk terjual | Stok historis tidak berubah karena `inventory_transactions` sudah frozen |
| Stok minus karena pembulatan | `DECIMAL(12,3)` untuk jumlah, bukan `INT` |
| Pemotongan stok gagal di tengah jalan | Satu transaksi untuk seluruh bahan dalam satu order |
