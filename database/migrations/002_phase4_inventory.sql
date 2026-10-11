-- ============================================================================
--  Migration 002 - Fase 4: Inventory Bahan Baku, Recipe/BOM, Stock Opname
-- ----------------------------------------------------------------------------
--  Berbeda dengan schema.sql, berkas ini TIDAK menghapus database.
--  Dipakai untuk menaikkan instalasi Fase 1-3 yang sudah ada.
--
--  Semua statement memakai CREATE TABLE IF NOT EXISTS sehingga aman dijalankan
--  berulang kali.
--
--  Jalankan:  npm run migrate:phase4
-- ============================================================================

USE `restaurant_management`;


-- ---------------------------------------------------------------------------
--  Bahan baku (master data)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `ingredients` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`          VARCHAR(30)  NOT NULL,
  `name`          VARCHAR(150) NOT NULL,
  `unit`          ENUM('gram','kg','ml','liter','pcs','pack','bottle','cans')
                  NOT NULL DEFAULT 'gram',
  `stock`         DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  `minimum_stock` DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  `unit_price`    DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  -- Supplier masih Fase 5, jadi kolom ini tanpa foreign key dulu.
  `supplier_id`   BIGINT UNSIGNED DEFAULT NULL,
  `is_active`     TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ingredients_code` (`code`),
  KEY `idx_ingredients_name` (`name`),
  KEY `idx_ingredients_active` (`is_active`),
  KEY `idx_ingredients_low_stock` (`stock`, `minimum_stock`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------------
--  Recipe / BOM
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `recipes` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_id`     BIGINT UNSIGNED NOT NULL,
  `name`           VARCHAR(150) NOT NULL,
  `yield_quantity` DECIMAL(12,3) NOT NULL DEFAULT 1.000,
  `note`           VARCHAR(500)  DEFAULT NULL,
  `is_active`      TINYINT(1)    NOT NULL DEFAULT 1,
  `created_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                                 ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_recipes_product` (`product_id`),
  CONSTRAINT `fk_recipes_product`
    FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS `recipe_items` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `recipe_id`     BIGINT UNSIGNED NOT NULL,
  `ingredient_id` BIGINT UNSIGNED NOT NULL,
  `quantity`      DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  `waste_percent` DECIMAL(5,2)   NOT NULL DEFAULT 0.00,
  `note`          VARCHAR(255)   DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_recipe_items_recipe_ingredient` (`recipe_id`, `ingredient_id`),
  KEY `idx_recipe_items_ingredient` (`ingredient_id`),
  CONSTRAINT `fk_recipe_items_recipe`
    FOREIGN KEY (`recipe_id`) REFERENCES `recipes` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_recipe_items_ingredient`
    FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------------
--  Jurnal mutasi stok
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `inventory_transactions` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ingredient_id`  BIGINT UNSIGNED NOT NULL,
  `type`           ENUM('PURCHASE','SALE','ADJUSTMENT','OPNAME','WASTE','VOID','RETURN')
                   NOT NULL,
  `quantity_in`    DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  `quantity_out`   DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  `stock_before`   DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  `stock_after`    DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  `reference_type` VARCHAR(30)     DEFAULT NULL,
  `reference_id`   BIGINT UNSIGNED DEFAULT NULL,
  `order_id`       BIGINT UNSIGNED DEFAULT NULL,
  `note`           VARCHAR(255)     DEFAULT NULL,
  `created_by`     BIGINT UNSIGNED  DEFAULT NULL,
  `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_inv_tx_ingredient_created` (`ingredient_id`, `created_at`),
  KEY `idx_inv_tx_order` (`order_id`),
  KEY `idx_inv_tx_type_created` (`type`, `created_at`),
  KEY `idx_inv_tx_reference` (`reference_type`, `reference_id`),
  CONSTRAINT `fk_inv_tx_ingredient`
    FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_inv_tx_order`
    FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_inv_tx_user`
    FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------------
--  Stock opname
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `stock_opnames` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `opname_number` VARCHAR(30)  NOT NULL,
  `status`        ENUM('DRAFT','APPROVED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `note`          VARCHAR(500) DEFAULT NULL,
  `created_by`    BIGINT UNSIGNED DEFAULT NULL,
  `approved_by`   BIGINT UNSIGNED DEFAULT NULL,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `approved_at`   DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stock_opnames_number` (`opname_number`),
  KEY `idx_stock_opnames_status` (`status`),
  CONSTRAINT `fk_stock_opnames_created_by`
    FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_opnames_approved_by`
    FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS `stock_opname_items` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `stock_opname_id` BIGINT UNSIGNED NOT NULL,
  `ingredient_id`   BIGINT UNSIGNED NOT NULL,
  `system_stock`    DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  `physical_stock`  DECIMAL(12,3) DEFAULT NULL,
  `difference`      DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  `note`            VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_opname_items_opname_ingredient` (`stock_opname_id`, `ingredient_id`),
  KEY `idx_opname_items_ingredient` (`ingredient_id`),
  CONSTRAINT `fk_opname_items_opname`
    FOREIGN KEY (`stock_opname_id`) REFERENCES `stock_opnames` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_opname_items_ingredient`
    FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;