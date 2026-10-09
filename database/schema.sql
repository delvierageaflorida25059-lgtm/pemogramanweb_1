-- ============================================================================
--  Smart Restaurant Management System
--  Schema Database - Fase 1 sampai Fase 3
--  Target : MariaDB 10.4 (XAMPP) dengan kompatibilitas MySQL 8
--
--  CATATAN KOMPATIBILITAS
--  - sengaja tidak memakai CHECK constraint karena MariaDB 10.4 mengabaikannya.
--    Validasi enum tetap dijaga oleh tipe ENUM dan oleh layer aplikasi.
--  - semua nilai uang memakai DECIMAL (bukan FLOAT/DOUBLE) agar tidak ada
--    pembulatanFloating point pada proses kalkulasi total.
--  - kolom waktu memakai DATETIME supaya tidak ikut berubah oleh konversi
--    zona waktu server.
--
--  Jalankan:  npm run migrate
--  Catatan: file ini menghapus database lama sebelum membuat ulang.
--           Jalankan "npm run reset" bila memang ingin regenerate total.
-- ============================================================================

-- Hapus database lama bila perlu regenerate total.
DROP DATABASE IF EXISTS `restaurant_management`;
CREATE DATABASE `restaurant_management`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `restaurant_management`;


-- ============================================================================
--  1. RBAC - Role, Permission, User
-- ============================================================================

CREATE TABLE `roles` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(50)  NOT NULL,
  `description` VARCHAR(255) DEFAULT NULL,
  -- Role sistem tidak boleh dihapus / diubah nama (mis. ADMIN).
  `is_system`   TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_roles_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE `permissions` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- Format: "<modul>.<aksi>" contoh "order.create"
  `code`        VARCHAR(100) NOT NULL,
  `module`      VARCHAR(50)  NOT NULL,
  `action`      VARCHAR(50)  NOT NULL,
  `description` VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_permissions_code` (`code`),
  KEY `idx_permissions_module` (`module`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE `role_permissions` (
  `role_id`       BIGINT UNSIGNED NOT NULL,
  `permission_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`role_id`, `permission_id`),
  KEY `idx_role_permissions_permission` (`permission_id`),
  CONSTRAINT `fk_role_permissions_role`
    FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_role_permissions_permission`
    FOREIGN KEY (`permission_id`) REFERENCES `permissions` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE `users` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`          VARCHAR(100) NOT NULL,
  `email`         VARCHAR(150) NOT NULL,
  `phone`         VARCHAR(30)  DEFAULT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `status`        ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `must_change_password` TINYINT(1) NOT NULL DEFAULT 0,
  `last_login_at` DATETIME    DEFAULT NULL,
  `created_at`    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP
                              ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`),
  KEY `idx_users_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE `user_roles` (
  `user_id`    BIGINT UNSIGNED NOT NULL,
  `role_id`    BIGINT UNSIGNED NOT NULL,
  `assigned_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `role_id`),
  KEY `idx_user_roles_role` (`role_id`),
  CONSTRAINT `fk_user_roles_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_user_roles_role`
    FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE `refresh_tokens` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    BIGINT UNSIGNED NOT NULL,
  -- Disimpan dalam bentuk SHA-256, bukan token mentah.
  `token_hash` CHAR(64)     NOT NULL,
  `expires_at` DATETIME     NOT NULL,
  `revoked_at` DATETIME     DEFAULT NULL,
  `ip_address` VARCHAR(45)  DEFAULT NULL,
  `user_agent` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_refresh_tokens_hash` (`token_hash`),
  KEY `idx_refresh_tokens_user` (`user_id`),
  CONSTRAINT `fk_refresh_tokens_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================================
--  2. Pelanggan
-- ============================================================================

CREATE TABLE `customers` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`       VARCHAR(100) NOT NULL,
  `phone`      VARCHAR(30)  DEFAULT NULL,
  `email`      VARCHAR(150) DEFAULT NULL,
  `notes`      VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_customers_email` (`email`),
  KEY `idx_customers_phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================================
--  3. Menu - Kategori, Produk, Varian, Addon
-- ============================================================================

CREATE TABLE `categories` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(100) NOT NULL,
  `description` VARCHAR(255) DEFAULT NULL,
  -- Urutan tampil di halaman menu customer.
  `sort_order`  INT NOT NULL DEFAULT 0,
  `is_active`   TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_categories_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE `products` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `category_id` BIGINT UNSIGNED NOT NULL,
  `code`        VARCHAR(30)  NOT NULL,
  `name`        VARCHAR(150) NOT NULL,
  `description` TEXT         DEFAULT NULL,
  -- Harga dasar produk. Harga varian dan addon ditambahkan terpisah.
  `price`       DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `image_url`   VARCHAR(255) DEFAULT NULL,
  `stock_status` ENUM('AVAILABLE','UNAVAILABLE') NOT NULL DEFAULT 'AVAILABLE',
  `is_active`   TINYINT(1)   NOT NULL DEFAULT 1,
  `sort_order`  INT          NOT NULL DEFAULT 0,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_products_code` (`code`),
  KEY `idx_products_category` (`category_id`),
  KEY `idx_products_active` (`is_active`, `stock_status`),
  CONSTRAINT `fk_products_category`
    FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE `product_variants` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_id` BIGINT UNSIGNED NOT NULL,
  `name`       VARCHAR(100) NOT NULL,
  -- Harga absolut varian. NULL berarti pakai harga dasar produk.
  `price`      DECIMAL(15,2) DEFAULT NULL,
  `is_default` TINYINT(1)    NOT NULL DEFAULT 0,
  `is_active`  TINYINT(1)    NOT NULL DEFAULT 1,
  `sort_order` INT           NOT NULL DEFAULT 0,
  `created_at` DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                           ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_product_variants_name` (`product_id`, `name`),
  KEY `idx_product_variants_product` (`product_id`),
  CONSTRAINT `fk_product_variants_product`
    FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE `product_addons` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- Addon boleh menempel ke satu produk atau ke satu kategori.
  -- Minimal salah satu harus terisi (divalidasi di service).
  `product_id`  BIGINT UNSIGNED DEFAULT NULL,
  `category_id` BIGINT UNSIGNED DEFAULT NULL,
  `name`        VARCHAR(100) NOT NULL,
  `price`       DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `is_active`   TINYINT(1)    NOT NULL DEFAULT 1,
  `sort_order`  INT           NOT NULL DEFAULT 0,
  `created_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_product_addons_product` (`product_id`),
  KEY `idx_product_addons_category` (`category_id`),
  CONSTRAINT `fk_product_addons_product`
    FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_product_addons_category`
    FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================================
--  4. Meja dan QR Code
-- ============================================================================

CREATE TABLE `restaurant_tables` (
  `id`        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- Kode meja yang dicetak pada QR, contoh "A12".
  `code`      VARCHAR(20)  NOT NULL,
  `name`      VARCHAR(100) NOT NULL,
  `zone`      VARCHAR(50)  DEFAULT NULL,
  `capacity`  INT          NOT NULL DEFAULT 4,
  `status`    ENUM('AVAILABLE','OCCUPIED','RESERVED','DISABLED')
              NOT NULL DEFAULT 'AVAILABLE',
  `is_active` TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP
                           ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_restaurant_tables_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE `table_qr_codes` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `table_id`   BIGINT UNSIGNED NOT NULL,
  -- Token acak yang tertanam di QR. QR hanya membawa token, bukan data harga.
  `token`      VARCHAR(64)  NOT NULL,
  `label`      VARCHAR(100) DEFAULT NULL,
  `is_active`  TINYINT(1)   NOT NULL DEFAULT 1,
  `scan_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `generated_at` DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `revoked_at` DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_table_qr_codes_token` (`token`),
  KEY `idx_table_qr_codes_table` (`table_id`),
  CONSTRAINT `fk_table_qr_codes_table`
    FOREIGN KEY (`table_id`) REFERENCES `restaurant_tables` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================================
--  5. Order, Order Item, Addon, Payment
-- ============================================================================

CREATE TABLE `orders` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- Format ORD-YYYYMMDD-00001, diisi setelah insert memakai id.
  `order_number` VARCHAR(30)  NOT NULL,
  -- QR = pesan sendiri lewat scan QR, POS = pesan lewat kasir.
  `source`      ENUM('QR','POS') NOT NULL DEFAULT 'QR',
  `table_id`    BIGINT UNSIGNED DEFAULT NULL,
  `customer_id` BIGINT UNSIGNED DEFAULT NULL,
  `created_by`  BIGINT UNSIGNED DEFAULT NULL,
  -- Alur: PENDING -> CONFIRMED -> PREPARING -> READY -> COMPLETED
  -- CANCELLED dipakai untuk void/refund sebelum produk dikerjakan.
  `status`      ENUM('PENDING','CONFIRMED','PREPARING','READY',
                     'COMPLETED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  -- Total disimpan frozen (snapshot) supaya struk lama tidak ikut berubah
  -- bila harga produk atau pengaturan pajak diubah setelah transaksi dibuat.
  `subtotal`         DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `discount_percent` DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
  `discount_amount`  DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `tax_percent`      DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
  `tax_amount`       DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `service_charge_percent` DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  `service_charge_amount`  DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `total`            DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `paid_amount`      DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `note`        VARCHAR(500) DEFAULT NULL,
  `cancelled_at` DATETIME DEFAULT NULL,
  `cancelled_by` BIGINT UNSIGNED DEFAULT NULL,
  `cancel_reason` VARCHAR(255) DEFAULT NULL,
  `completed_at` DATETIME DEFAULT NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_orders_order_number` (`order_number`),
  KEY `idx_orders_status_created` (`status`, `created_at`),
  KEY `idx_orders_table` (`table_id`),
  KEY `idx_orders_customer` (`customer_id`),
  KEY `idx_orders_created_at` (`created_at`),
  CONSTRAINT `fk_orders_table`
    FOREIGN KEY (`table_id`) REFERENCES `restaurant_tables` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_orders_customer`
    FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_orders_created_by`
    FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_orders_cancelled_by`
    FOREIGN KEY (`cancelled_by`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE `order_items` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id`   BIGINT UNSIGNED NOT NULL,
  `product_id` BIGINT UNSIGNED NOT NULL,
  -- Snapshot nama & harga saat transaksi dibuat.
  -- Dipakai supaya struk historis tidak berubah bila produk dihapus/berganti harga.
  `product_name`  VARCHAR(150)   NOT NULL,
  `product_code`  VARCHAR(30)    DEFAULT NULL,
  `variant_id`    BIGINT UNSIGNED DEFAULT NULL,
  `variant_name`  VARCHAR(100)   DEFAULT NULL,
  `unit_price`    DECIMAL(15,2) NOT NULL,
  `quantity`      INT            NOT NULL DEFAULT 1,
  -- (unit_price + total harga addon) * quantity
  `line_total`    DECIMAL(15,2) NOT NULL,
  `note`          VARCHAR(255)   DEFAULT NULL,
  `created_at`    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_order_items_order` (`order_id`),
  KEY `idx_order_items_product` (`product_id`),
  CONSTRAINT `fk_order_items_order`
    FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_order_items_product`
    FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_order_items_variant`
    FOREIGN KEY (`variant_id`) REFERENCES `product_variants` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE `order_item_addons` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_item_id`  BIGINT UNSIGNED NOT NULL,
  `product_addon_id` BIGINT UNSIGNED NOT NULL,
  `addon_name`     VARCHAR(100)   NOT NULL,
  -- Harga addon saat transaksi, bukan harga saat ini.
  `price`          DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `quantity`       INT            NOT NULL DEFAULT 1,
  `line_total`     DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (`id`),
  KEY `idx_order_item_addons_item` (`order_item_id`),
  CONSTRAINT `fk_order_item_addons_item`
    FOREIGN KEY (`order_item_id`) REFERENCES `order_items` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_order_item_addons_addon`
    FOREIGN KEY (`product_addon_id`) REFERENCES `product_addons` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE `payments` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id`      BIGINT UNSIGNED NOT NULL,
  -- Pembayaran simulasi Fase 1-3. Integrasi gateway nyata menyusul.
  `method`        ENUM('CASH','TRANSFER','QRIS','CARD') NOT NULL,
  `amount`        DECIMAL(15,2) NOT NULL,
  -- Kembalian untuk metode CASH.
  `change_amount` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `status`        ENUM('PENDING','SUCCESS','FAILED','REFUNDED','PARTIAL_REFUND')
                  NOT NULL DEFAULT 'SUCCESS',
  `refunded_amount` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `reference`     VARCHAR(100) DEFAULT NULL,
  -- Nozzle / terminal / nama staff kasir.
  `paid_by`       BIGINT UNSIGNED DEFAULT NULL,
  `note`          VARCHAR(255) DEFAULT NULL,
  `paid_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_payments_order` (`order_id`),
  KEY `idx_payments_method_status` (`method`, `status`),
  KEY `idx_payments_paid_at` (`paid_at`),
  CONSTRAINT `fk_payments_order`
    FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_payments_paid_by`
    FOREIGN KEY (`paid_by`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Riwayat perpindahan status order, dipakai Kitchen Display dan audit.
CREATE TABLE `order_status_history` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id`   BIGINT UNSIGNED NOT NULL,
  `from_status` VARCHAR(20)  DEFAULT NULL,
  `to_status`  VARCHAR(20)  NOT NULL,
  `changed_by` BIGINT UNSIGNED DEFAULT NULL,
  `note`       VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_order_status_history_order` (`order_id`, `created_at`),
  CONSTRAINT `fk_order_status_history_order`
    FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_order_status_history_user`
    FOREIGN KEY (`changed_by`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================================
--  6. Notifikasi dan Audit Log
-- ============================================================================

CREATE TABLE `notifications` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- NULL = notifikasi broadcast ke semua user dengan permission terkait.
  `user_id`    BIGINT UNSIGNED DEFAULT NULL,
  `order_id`   BIGINT UNSIGNED DEFAULT NULL,
  `type`       VARCHAR(50)  NOT NULL DEFAULT 'INFO',
  `title`      VARCHAR(150) NOT NULL,
  `message`    VARCHAR(500) NOT NULL,
  `is_read`    TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_notifications_user_read` (`user_id`, `is_read`),
  KEY `idx_notifications_order` (`order_id`),
  CONSTRAINT `fk_notifications_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_notifications_order`
    FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE `audit_logs` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     BIGINT UNSIGNED DEFAULT NULL,
  `action`      VARCHAR(50)  NOT NULL,
  `entity_type` VARCHAR(50)  NOT NULL,
  `entity_id`   BIGINT UNSIGNED DEFAULT NULL,
  `description` VARCHAR(500) DEFAULT NULL,
  -- Pada MariaDB 10.4 JSON adalah alias LONGTEXT dan tidak boleh diberi DEFAULT,
  -- jadi kolom ini sengaja ditulis tanpa klausa DEFAULT (nullable by default).
  `metadata`    JSON         NULL,
  `ip_address`  VARCHAR(45)  DEFAULT NULL,
  `user_agent`  VARCHAR(255) DEFAULT NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_logs_user` (`user_id`),
  KEY `idx_audit_logs_entity` (`entity_type`, `entity_id`),
  KEY `idx_audit_logs_created` (`created_at`),
  CONSTRAINT `fk_audit_logs_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
