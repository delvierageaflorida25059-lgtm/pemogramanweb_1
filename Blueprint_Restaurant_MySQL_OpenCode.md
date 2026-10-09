# Blueprint Enterprise Smart Restaurant Management System

**Stack:** HTML + CSS + Vanilla JavaScript + Node.js/Express.js + MySQL 8  
**Target:** Web + Mobile PWA  
**Development:** VS Code + OpenCode

---

## 1. Tujuan Sistem

Sistem mengintegrasikan operasional restoran dalam satu aplikasi:

- Customer ordering melalui QR
- POS / Kasir
- Kitchen Display System
- Menu management
- Inventory dan stok bahan baku
- Recipe / BOM
- Procurement dan supplier
- Finance
- Daily reports
- User, Role & Permission
- Notification
- Audit log
- PWA untuk desktop dan mobile

---

# 2. Stack Teknologi

| Layer | Teknologi |
|---|---|
| Frontend | HTML + CSS + Vanilla JavaScript |
| Backend | Node.js + Express.js |
| Database | MySQL 8 |
| Database Driver | mysql2 |
| API | REST API |
| PWA | Web Manifest + Service Worker |
| Authentication | JWT + bcrypt |
| Realtime | Socket.IO |
| Development | VS Code + OpenCode |
| Optional Infrastructure | Docker + Redis + Nginx |

---

# 3. Modul Sistem

| Modul | Fungsi |
|---|---|
| Customer Ordering | QR menu, cart, order, status, payment |
| POS / Cashier | Transaksi, pembayaran, receipt, void/refund |
| Kitchen | Order masuk, preparing, ready, completed |
| Menu Management | Kategori, produk, varian, addon, harga |
| Inventory | Bahan, stok, adjustment, stock opname |
| Recipe / BOM | Relasi produk dengan bahan baku |
| Procurement | Supplier, purchase request, purchase order, receiving |
| Finance | Revenue, expense, cash transaction |
| Reports | Sales, expense, payment, best seller, stock |
| RBAC | User, role, permission |
| Notification | Notifikasi order dan stok |
| Audit Log | Pencatatan aktivitas sistem |

---

# 4. Arsitektur Sistem

```text
Customer / Staff
       ↓
HTML + CSS + JavaScript / PWA
       ↓
Fetch API / Socket.IO
       ↓
Node.js + Express.js
       ↓
Routes → Controllers → Services
       ↓
mysql2
       ↓
MySQL 8
       ↓
Reports / Audit / Backup
```

## Arsitektur Backend

```text
Request
   ↓
Route
   ↓
Middleware
   ↓
Controller
   ↓
Service
   ↓
MySQL
   ↓
Response
```

---

# 5. Alur Bisnis Utama

## Customer Ordering

```text
SCAN QR / LOGIN
       ↓
MENU
       ↓
PILIH PRODUK
       ↓
CART
       ↓
CREATE ORDER
       ↓
PAYMENT
       ↓
┌────────────┬────────────┬────────────┐
│            │            │            │
▼            ▼            ▼
KITCHEN    INVENTORY    FINANCE
│            │            │
▼            ▼            ▼
PROCESS     DEDUCT       REVENUE
ORDER       STOCK        RECORD
│            │            │
└────────────┴────────────┘
             ↓
      DASHBOARD / REPORT
```

---

# 6. Customer QR Ordering

Setiap meja memiliki QR Code.

Contoh:

```text
https://restaurant.com/menu?table=A12
```

QR sebaiknya menyimpan **identifier meja**, bukan harga/menu secara langsung.

### Flow

```text
Customer Scan QR
       ↓
System membaca table ID
       ↓
Menu ditampilkan
       ↓
Customer memilih produk
       ↓
Cart
       ↓
Create Order
       ↓
Payment
       ↓
Kitchen menerima order
```

---

# 7. POS / Cashier

Flow kasir:

```text
Cashier Login
     ↓
Pilih Table / Customer
     ↓
Pilih Menu
     ↓
Cart
     ↓
Subtotal
     ↓
Discount
     ↓
Tax / Service Charge
     ↓
Total
     ↓
Payment
     ↓
Receipt
     ↓
Order Complete
```

Payment dapat mendukung:

- Cash
- Transfer
- QR payment
- Payment gateway
- Card

---

# 8. Kitchen Display System

Kitchen mendapatkan order setelah order berhasil dibuat.

Status:

```text
PENDING
   ↓
CONFIRMED
   ↓
PREPARING
   ↓
READY
   ↓
COMPLETED
```

Kitchen hanya dapat mengubah status yang sesuai dengan permission.

---

# 9. Inventory

Inventory mengelola bahan baku.

Contoh:

```text
Nasi Goreng
├── Rice
├── Egg
├── Chicken
├── Cooking Oil
└── Seasoning
```

Ketika produk terjual:

```text
Order
 ↓
Order Item
 ↓
Recipe / BOM
 ↓
Ingredient
 ↓
Inventory Transaction
 ↓
Stock berkurang
```

---

# 10. Recipe / BOM

Recipe digunakan untuk menghubungkan produk dengan bahan baku.

Contoh:

```text
Product: Nasi Goreng

Rice        = 150 gram
Egg         = 1 pcs
Chicken     = 50 gram
Oil         = 10 ml
Seasoning   = 5 gram
```

Dengan sistem ini, stok bahan dapat dihitung berdasarkan jumlah produk yang terjual.

---

# 11. Procurement

Flow procurement:

```text
Check Stock
     ↓
Stock < Minimum?
     ↓
Purchase Request
     ↓
Manager Approval
     ↓
Purchase Order
     ↓
Supplier
     ↓
Goods Receipt
     ↓
Verify Quantity
     ↓
Inventory Update
```

---

# 12. Finance

Finance mencatat:

- Revenue
- Expense
- Cash transaction
- Payment
- Refund
- Daily financial summary

Contoh laporan harian:

```text
Tanggal              : 08 Oktober 2026
Total Transaksi      : 120
Total Revenue        : Rp 8.500.000
Cash                 : Rp 3.000.000
QR Payment           : Rp 4.000.000
Card                 : Rp 1.500.000
Expense              : Rp 1.200.000
```

> Catatan: `Revenue - Expense` merupakan ringkasan hasil kas sederhana, bukan laporan laba akuntansi penuh.

---

# 13. Database MySQL

## Daftar Tabel

```text
users
roles
permissions
user_roles

customers

categories
products
product_variants
product_addons

restaurant_tables
table_qr_codes

orders
order_items
order_item_addons
payments

ingredients
recipes
recipe_items
inventory_transactions
stock_opnames

suppliers
purchase_requests
purchase_request_items
purchase_orders
purchase_order_items
goods_receipts

expenses
cash_transactions
daily_reports

notifications
audit_logs
```

---

# 14. Relasi Database / ERD Konseptual

```text
categories
    │
    └──────< products
                │
                ├──────< product_variants
                ├──────< product_addons
                │
                └──────< recipes
                            │
                            └──────< recipe_items >────── ingredients
                                                              │
                                                              └──── inventory_transactions


restaurant_tables
    │
    └────── table_qr_codes


orders
    │
    ├──────< order_items
    │          │
    │          └────── products
    │
    └──────< payments


suppliers
    │
    └──────< purchase_orders
                  │
                  └──────< purchase_order_items


users
    │
    └──────< user_roles >────── roles
                                  │
                                  └──────< permissions
```

---

# 15. Contoh Schema MySQL

```sql
CREATE DATABASE restaurant_management;

USE restaurant_management;

CREATE TABLE users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    status ENUM('ACTIVE', 'INACTIVE') DEFAULT 'ACTIVE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE products (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    category_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    price DECIMAL(15,2) NOT NULL,
    stock_status ENUM('AVAILABLE', 'UNAVAILABLE')
        DEFAULT 'AVAILABLE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
);
```

---

# 16. Struktur Project

```text
restaurant-management/
│
├── frontend/
│   ├── index.html
│   ├── menu.html
│   ├── cart.html
│   ├── order.html
│   ├── login.html
│   ├── dashboard.html
│   │
│   ├── css/
│   │   └── style.css
│   │
│   ├── js/
│   │   ├── api.js
│   │   ├── auth.js
│   │   ├── menu.js
│   │   ├── cart.js
│   │   ├── order.js
│   │   ├── cashier.js
│   │   └── dashboard.js
│   │
│   └── assets/
│
├── backend/
│   ├── server.js
│   │
│   ├── config/
│   │   └── database.js
│   │
│   ├── routes/
│   │   ├── auth.js
│   │   ├── products.js
│   │   ├── orders.js
│   │   ├── payments.js
│   │   ├── inventory.js
│   │   ├── procurement.js
│   │   └── reports.js
│   │
│   ├── controllers/
│   ├── services/
│   ├── middleware/
│   └── utils/
│
├── database/
│   ├── schema.sql
│   ├── seed.sql
│   └── migrations/
│
├── docs/
│   ├── uml/
│   ├── erd/
│   ├── flowchart/
│   └── api/
│
├── .env
├── .env.example
├── package.json
├── docker-compose.yml
└── README.md
```

---

# 17. REST API

## Authentication

```http
POST /api/auth/login
POST /api/auth/register
POST /api/auth/refresh
POST /api/auth/logout
```

## Products

```http
GET    /api/products
GET    /api/products/:id
POST   /api/products
PUT    /api/products/:id
DELETE /api/products/:id
```

## Orders

```http
POST   /api/orders
GET    /api/orders
GET    /api/orders/:id
PATCH  /api/orders/:id/status
```

## Payments

```http
POST /api/payments
GET  /api/payments/:id
POST /api/payments/refund
```

## Inventory

```http
GET  /api/inventory
GET  /api/inventory/:id
POST /api/inventory/adjustment
POST /api/inventory/stock-opname
```

## Procurement

```http
POST /api/procurement/purchase-requests
POST /api/procurement/purchase-orders
PATCH /api/procurement/purchase-orders/:id
POST /api/procurement/goods-receipts
```

## Reports

```http
GET /api/reports/daily-sales
GET /api/reports/daily-expenses
GET /api/reports/daily-finance
GET /api/reports/best-selling-products
GET /api/reports/inventory
```

---

# 18. Role & Permission

| Role | Akses |
|---|---|
| Customer | Menu, order, payment, riwayat |
| Cashier | POS, payment, receipt, void/refund |
| Kitchen | Melihat dan memproses order |
| Inventory | Stok, bahan, stock opname |
| Procurement | Supplier, PR, PO, receiving |
| Manager | Approval dan laporan |
| Admin | User, role, menu, konfigurasi |
| Owner | Dashboard dan laporan bisnis |

---

# 19. UML yang Perlu Dibuat

Blueprint UML terdiri dari:

1. Use Case Diagram
2. Activity Diagram Customer Ordering
3. Activity Diagram POS
4. Activity Diagram Procurement
5. Sequence Diagram Customer Order
6. Sequence Diagram Payment
7. Sequence Diagram Inventory Deduction
8. Class Diagram
9. Component Diagram
10. Deployment Diagram
11. ERD

---

# 20. Security

Gunakan:

- HTTPS
- bcrypt untuk password
- JWT access token
- Refresh token
- RBAC server-side
- Input validation
- Parameterized SQL query
- Rate limiting
- CORS
- Audit log
- Database backup
- Environment variables
- Server-side payment validation

Jangan menyimpan:

```text
password
JWT secret
API key
payment secret
database password
```

langsung di source code.

Gunakan `.env`.

---

# 21. PWA

Fitur PWA:

```text
Web App
   ↓
manifest.json
   ↓
Service Worker
   ↓
Cache aset aman
   ↓
Installable Web App
```

Target:

- Responsive desktop
- Responsive mobile
- Installable
- Service worker
- Web manifest
- Push notification

Operasi kritis seperti pembayaran, POS, dan perubahan stok sebaiknya membutuhkan koneksi aktif agar konflik data tidak terjadi.

---

# 22. Docker

Contoh:

```yaml
services:

  mysql:
    image: mysql:8.0
    environment:
      MYSQL_DATABASE: restaurant_management
      MYSQL_USER: restaurant_user
      MYSQL_PASSWORD: restaurant_password
      MYSQL_ROOT_PASSWORD: root_password
    ports:
      - "3306:3306"

  backend:
    build: ./backend
    ports:
      - "3000:3000"
    depends_on:
      - mysql
```

---

# 23. Tahapan Development

## Phase 1 - Foundation

- Setup project
- Setup Node.js
- Setup Express
- Setup MySQL
- Database schema
- Seed data
- Authentication
- User
- Role
- Permission

## Phase 2 - Menu & Ordering

- Category
- Product
- Product variant
- Addon
- Restaurant table
- QR Code
- Customer ordering
- Cart
- Order

## Phase 3 - POS & Kitchen

- POS
- Payment
- Receipt
- Kitchen Display
- Order status
- Void/refund

## Phase 4 - Inventory

- Ingredients
- Recipe/BOM
- Stock
- Inventory transaction
- Stock opname
- Minimum stock

## Phase 5 - Procurement

- Supplier
- Purchase Request
- Approval
- Purchase Order
- Goods Receipt

## Phase 6 - Finance

- Revenue
- Expense
- Cash transaction
- Daily report
- Payment summary

## Phase 7 - Enterprise Features

- Notification
- Audit log
- Dashboard
- Analytics
- Backup
- Deployment

---

# 24. Prompt Awal untuk OpenCode

```text
Build a Smart Restaurant Management System using:

Frontend:
- HTML
- CSS
- Vanilla JavaScript

Backend:
- Node.js
- Express.js

Database:
- MySQL 8
- mysql2

Authentication:
- JWT
- bcrypt

Realtime:
- Socket.IO

PWA:
- Web Manifest
- Service Worker

The system must support:

1. Customer QR ordering
2. Restaurant table management
3. Menu management
4. Cart and order management
5. POS / cashier
6. Payment
7. Kitchen Display System
8. Inventory management
9. Recipe / BOM
10. Procurement
11. Supplier management
12. Finance
13. Daily reports
14. User management
15. Role Based Access Control
16. Notifications
17. Audit logs
18. PWA functionality

Use this project structure:

restaurant-management/
├── frontend/
├── backend/
├── database/
├── docs/
├── .env.example
├── package.json
├── docker-compose.yml
└── README.md

Backend structure:

backend/
├── server.js
├── config/
├── routes/
├── controllers/
├── services/
├── middleware/
└── utils/

Database:

database/
├── schema.sql
├── seed.sql
└── migrations/

Important requirements:

- Use MySQL 8.
- Use mysql2.
- Use parameterized SQL queries.
- Never concatenate user input directly into SQL queries.
- Use environment variables for secrets.
- Use bcrypt for passwords.
- Use JWT authentication.
- Implement RBAC on the backend.
- Validate request data.
- Use centralized error handling.
- Keep frontend and backend separated.
- Make every module modular and testable.
- Write clear comments only where necessary.
- Create README documentation.
- Keep the code understandable for an Informatics student.
- Build the project incrementally.

Development order:

1. Database schema
2. Seed data
3. MySQL connection
4. Express server
5. Authentication
6. RBAC
7. Menu CRUD
8. Restaurant tables and QR
9. Customer ordering
10. POS
11. Payment
12. Kitchen
13. Inventory
14. Recipe/BOM
15. Procurement
16. Finance
17. Reports
18. Notifications
19. Audit log
20. PWA
21. Testing
22. Documentation

Do not implement all modules in one huge file.
Keep the code modular and maintainable.
