# Class Diagram - Smart Restaurant Management System

Diagram kelas untuk entity domain yang sudah diimplementasikan (Fase 1-3),
disertai kelas konseptual Fase 4-6.

## Domain yang Diimplementasikan (Fase 1-3)

```mermaid
classDiagram
    direction LR

    class User {
        +BigInt id
        +String name
        +String email
        +String password_hash
        +Enum status
        +DateTime last_login_at
        +findAuthUserById()
        +findByEmail()
        +create()
        +update()
        +remove()
        +setPassword()
    }

    class Role {
        +BigInt id
        +String name
        +String description
        +Boolean is_system
        +list()
        +findById()
    }

    class Permission {
        +BigInt id
        +String code
        +String module
        +String action
        +listByModule()
    }

    class RefreshToken {
        +BigInt id
        +BigInt user_id
        +String token_hash
        +DateTime expires_at
        +DateTime revoked_at
        +revoke()
        +cleanup()
    }

    class Customer {
        +BigInt id
        +String name
        +String phone
        +String email
        +findOrCreateByPhone()
    }

    class Category {
        +BigInt id
        +String name
        +Int sort_order
        +Boolean is_active
        +list()
        +create()
        +update()
        +remove()
    }

    class Product {
        +BigInt id
        +BigInt category_id
        +String code
        +String name
        +Decimal price
        +Enum stock_status
        +Boolean is_active
        +list()
        +findById()
        +findByIds()
        +create()
        +update()
        +remove()
        +setStockStatus()
    }

    class ProductVariant {
        +BigInt id
        +BigInt product_id
        +String name
        +Decimal price
        +Boolean is_default
    }

    class ProductAddon {
        +BigInt id
        +BigInt product_id
        +BigInt category_id
        +String name
        +Decimal price
    }

    class RestaurantTable {
        +BigInt id
        +String code
        +String name
        +String zone
        +Int capacity
        +Enum status
        +list()
        +findByCode()
        +create()
        +update()
        +remove()
    }

    class TableQrCode {
        +BigInt id
        +BigInt table_id
        +String token
        +Int scan_count
        +DateTime revoked_at
        +issue()
        +resolveToken()
    }

    class Order {
        +BigInt id
        +String order_number
        +Enum source
        +Enum status
        +Decimal subtotal
        +Decimal discount_amount
        +Decimal tax_amount
        +Decimal service_charge_amount
        +Decimal total
        +Decimal paid_amount
        +create()
        +findById()
        +list()
        +changeStatus()
        +cancel()
        +canTransition()
    }

    class OrderItem {
        +BigInt id
        +BigInt order_id
        +BigInt product_id
        +String product_name
        +Decimal unit_price
        +Int quantity
        +Decimal line_total
    }

    class OrderItemAddon {
        +BigInt id
        +BigInt order_item_id
        +BigInt product_addon_id
        +String addon_name
        +Decimal price
        +Int quantity
    }

    class Payment {
        +BigInt id
        +BigInt order_id
        +Enum method
        +Decimal amount
        +Decimal change_amount
        +Enum status
        +Decimal refunded_amount
        +create()
        +list()
        +refund()
        +summaryByMethod()
    }

    class OrderStatusHistory {
        +BigInt id
        +BigInt order_id
        +String from_status
        +String to_status
        +BigInt changed_by
    }

    class Notification {
        +BigInt id
        +BigInt user_id
        +BigInt order_id
        +String type
        +Boolean is_read
        +create()
        +list()
        +markRead()
    }

    class AuditLog {
        +BigInt id
        +BigInt user_id
        +String action
        +String entity_type
        +BigInt entity_id
        +JSON metadata
    }

    %% Relasi RBAC
    User "1" -- "0..*" RefreshToken : memiliki
    User "0..*" -- "0..*" Role : "user_roles"
    Role "0..*" -- "0..*" Permission : "role_permissions"

    %% Relasi menu
    Category "1" -- "0..*" Product : mengelompokkan
    Product "1" -- "0..*" ProductVariant : memiliki
    Product "0..*" -- "0..*" ProductAddon : memiliki
    Category "0..*" -- "0..*" ProductAddon : mencakup

    %% Relasi meja
    RestaurantTable "1" -- "0..*" TableQrCode : punya
    TableQrCode ..> RestaurantTable : "resolveToken()"

    %% Relasi order
    RestaurantTable "0..1" -- "0..*" Order : dipakai
    Customer "0..1" -- "0..*" Order : melakukan
    User "0..1" -- "0..*" Order : membuat
    Order "1" -- "1..*" OrderItem : berisi
    OrderItem "0..*" -- "1" Product : merujuk
    OrderItem "0..*" -- "0..*" ProductAddon : memiliki
    Order "1" -- "0..*" OrderItemAddon : rincian
    Order "1" -- "0..*" Payment : dibayar
    Order "1" -- "0..*" OrderStatusHistory : riwayat
    Notification "0..*" -- "0..1" Order : customize
    AuditLog "0..*" -- "0..1" User : aktor
```

## Utilitas dan Middleware

```mermaid
classDiagram
    direction TB

    class ApiError {
        <<utility>>
        +number statusCode
        +string code
        +object details
        +badRequest()
        +unauthorized()
        +forbidden()
        +notFound()
        +conflict()
        +unprocessable()
        +internal()
    }

    class Money {
        <<utility>>
        +round(value, decimals)
        +toNumber(value, fallback)
        +clampPercent(value)
        +calculateLineTotal(item)
        +calculateOrderTotals(items, options)
        +calculateChange(total, tender)
        +formatRupiah(value)
    }

    class TokenUtil {
        <<utility>>
        +signAccessToken(user)
        +signRefreshToken(userId)
        +verifyAccessToken(token)
        +verifyRefreshToken(token)
        +hashToken(token)
        +extractBearerToken(req)
    }

    class Response {
        <<utility>>
        +ok(res, options)
        +paginated(res, req, options)
        +getPagination(req, defaults)
    }

    class Database {
        <<utility>>
        +query(sql, params)
        +raw(sql)
        +withTransaction(callback)
        +testConnection()
    }

    class AsyncHandler {
        <<utility>>
        +asyncHandler(handler)
        +wrapRouter(router)
    }

    class RBAC {
        <<middleware>>
        +hasPermission(user, permission)
        +hasAnyPermission(user, permissions)
        +requirePermission(...permissions)
        +requireRole(...roles)
    }

    class AuthMiddleware {
        <<middleware>>
        +requireAuth(req, res, next)
        +optionalAuth(req, res, next)
    }

    class Validate {
        <<middleware>>
        +validate(schema)
    }

    class ErrorHandler {
        <<middleware>>
        +errorHandler(err, req, res, next)
        +notFoundHandler(req, res, next)
    }

    class Audit {
        <<middleware>>
        +writeAudit(entry)
        +auditMiddleware(req, res, next)
        +setAudit(res, entry)
    }

    AsyncHandler ..> ApiError : "menangkap error"
    TokenUtil ..> ApiError : "melempar"
    RBAC ..> ApiError : "melempar"
    ErrorHandler ..> ApiError : "memetakan"
```

## Domain Konseptual (Fase 4-6)

```mermaid
classDiagram
    direction LR

    class Ingredient {
        <<Fase 4>>
        +BigInt id
        +String name
        +String unit
        +Decimal stock
        +Decimal minimum_stock
    }

    class Recipe {
        <<Fase 4>>
        +BigInt id
        +BigInt product_id
        +Decimal yield_quantity
    }

    class RecipeItem {
        <<Fase 4>>
        +BigInt id
        +BigInt recipe_id
        +BigInt ingredient_id
        +Decimal quantity
        +Decimal waste_percent
    }

    class InventoryTransaction {
        <<Fase 4>>
        +BigInt id
        +BigInt ingredient_id
        +Enum type
        +Decimal quantity_in
        +Decimal quantity_out
        +String reference_type
    }

    class Supplier {
        <<Fase 5>>
        +BigInt id
        +String name
        +String contact_name
        +String phone
    }

    class PurchaseRequest {
        <<Fase 5>>
        +BigInt id
        +String request_number
        +Enum status
    }

    class PurchaseOrder {
        <<Fase 5>>
        +BigInt id
        +String po_number
        +BigInt supplier_id
        +Enum status
        +Decimal total_amount
    }

    class GoodsReceipt {
        <<Fase 5>>
        +BigInt id
        +String receipt_number
        +BigInt purchase_order_id
    }

    class Expense {
        <<Fase 6>>
        +BigInt id
        +String category
        +Decimal amount
    }

    class CashTransaction {
        <<Fase 6>>
        +BigInt id
        +Enum type (IN/OUT)
        +Decimal amount
    }

    class DailyReport {
        <<Fase 6>>
        +BigInt id
        +Date report_date
        +Decimal total_revenue
        +Decimal total_expense
    }

    Product "1" -- "0..1" Recipe : punya
    Recipe "1" -- "1..*" RecipeItem : terdiri dari
    Ingredient "1" -- "0..*" RecipeItem : dipakai
    Ingredient "1" -- "0..*" InventoryTransaction : "@@ movements"
    Supplier "0..1" -- "0..*" Ingredient : memasok
    Supplier "1" -- "0..*" PurchaseOrder : "@@ receives"
    PurchaseRequest "0..1" -- "0..*" PurchaseOrder : "@@ generates"
    PurchaseOrder "1" -- "0..*" GoodsReceipt : "@@ received"
```

## Catatan Desain Penting

| Keputusan | Alasan |
|---|---|
| Order menyimpan `product_name` dan `unit_price` sebagai snapshot | Struk lama tidak ikut berubah ketika harga produk atau aturan pajak diperbarui |
| `Order.soft delete` dihindari, memakai status `CANCELLED` | Menjaga integritas riwayat dan jejak audit |
| Produk yang sudah pernah dipesan tidak dihapus fisik (`ON DELETE RESTRICT`) | Melindungi integritas data transaksi |
| `hasPermission` dipanggil ulang di setiap request lewat `requireAuth` | Pencabutan permission langsung berlaku walau access token lama masih valid |
| Refresh token disimpan sebagai hash SHA-256 | Kalau database bocor, token curian tidak langsung bisa dipakai |
| Pembuatan order dibungkus `withTransaction` | Tidak ada order setengah jadi |
| Baris order dikunci `SELECT ... FOR UPDATE` saat pembayaran | Dua kasir tidak bisa membayar order yang sama sekaligus |