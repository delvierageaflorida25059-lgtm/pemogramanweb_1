'use strict';

/**
 * Seed data awal: role, permission, user, kategori, produk, meja, QR code.
 *
 * Password di-hash memakai bcryptjs. Karena itu seed implemented sebagai
 * script Node.js, bukan file SQL murni, agar bisa memanggil bcrypt.
 *
 * Sifat seed: idempotent. Menjalankan script dua kali tidak menggandakan
 * data dan tidak menimpa produk yang sudah diedit manual.
 *
 * Jalankan: npm run seed
 */

const bcrypt = require('bcryptjs');
const { nanoid } = require('nanoid');
const { query, withTransaction, closePool, testConnection } = require('../backend/config/database');

const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 10);

// ---------------------------------------------------------------------------
// Definisi permission
// ---------------------------------------------------------------------------

const PERMISSIONS = [
  // Menu
  ['category.view', 'Menu', 'view', 'Melihat daftar kategori'],
  ['category.manage', 'Menu', 'manage', 'Tambah dan ubah kategori'],
  ['product.view', 'Menu', 'view', 'Melihat daftar produk'],
  ['product.manage', 'Menu', 'manage', 'Tambah dan ubah produk'],
  ['product.delete', 'Menu', 'delete', 'Hapus produk'],
  // Meja dan QR
  ['table.view', 'Table', 'view', 'Melihat daftar meja'],
  ['table.manage', 'Table', 'manage', 'Tambah dan ubah meja'],
  ['table.qr', 'Table', 'qr', 'Buat dan cetak QR meja'],
  // Order
  ['order.view', 'Order', 'view', 'Melihat daftar order'],
  ['order.create', 'Order', 'create', 'Membuat order'],
  ['order.update', 'Order', 'update', 'Mengubah detail order'],
  ['order.cancel', 'Order', 'cancel', 'Membatalkan atau void order'],
  // Kitchen
  ['kitchen.view', 'Kitchen', 'view', 'Melihat papan Kitchen Display'],
  ['kitchen.process', 'Kitchen', 'process', 'Mengubah status order dapur'],
  // Payment
  ['payment.view', 'Payment', 'view', 'Melihat riwayat pembayaran'],
  ['payment.create', 'Payment', 'create', 'Mencatat pembayaran'],
  ['payment.refund', 'Payment', 'refund', 'Melakukan refund'],
  // Laporan
  ['report.view', 'Report', 'view', 'Melihat laporan penjualan'],
  ['report.finance', 'Report', 'finance', 'Melihat ringkasan keuangan'],
  // User dan RBAC
  ['user.view', 'User', 'view', 'Melihat daftar user'],
  ['user.manage', 'User', 'manage', 'Tambah dan ubah user'],
  ['role.view', 'RBAC', 'view', 'Melihat daftar role dan permission'],
  ['role.manage', 'RBAC', 'manage', 'Mengatur role dan permission'],
  // Inventory (Fase 4)
  ['inventory.view', 'Inventory', 'view', 'Melihat stok bahan baku dan jurnal mutasi'],
  ['inventory.manage', 'Inventory', 'manage', 'Mengelola bahan baku, recipe, dan stock opname'],
  // Audit dan notifikasi
  ['audit.view', 'System', 'audit', 'Melihat audit log'],
  ['notification.view', 'System', 'notification', 'Melihat notifikasi'],
];

// permission code -> daftar role yang memilikinya
const ROLE_PERMISSIONS = {
  CUSTOMER: ['notification.view'],
  CASHIER: [
    'category.view', 'product.view',
    'table.view',
    'order.view', 'order.create', 'order.update', 'order.cancel',
    'payment.view', 'payment.create',
    'report.view',
    'notification.view',
  ],
  KITCHEN: ['kitchen.view', 'kitchen.process', 'order.view', 'notification.view'],
  INVENTORY: [
    'category.view', 'product.view',
    'inventory.view', 'inventory.manage',
    'notification.view',
  ],
  PROCUREMENT: ['category.view', 'product.view', 'notification.view'],
  MANAGER: [
    'category.view', 'product.view',
    'table.view', 'table.qr',
    'order.view', 'order.cancel',
    'payment.view', 'payment.refund',
    'report.view', 'report.finance',
    'inventory.view',
    'user.view', 'role.view',
    'audit.view', 'notification.view',
  ],
  // ADMIN mendapat seluruh permission.
  ADMIN: null, // null berarti semua permission
  OWNER: [
    'category.view', 'product.view',
    'table.view', 'table.qr', 'table.manage',
    'order.view', 'order.cancel',
    'payment.view', 'payment.refund',
    'report.view', 'report.finance',
    'inventory.view',
    'user.view', 'role.view', 'audit.view', 'notification.view',
  ],
};

const ROLES = [
  ['CUSTOMER', 'Pelanggan yang pesan lewat QR Code'],
  ['CASHIER', 'Kasir / POS'],
  ['KITCHEN', 'Dapur / Kitchen Display'],
  ['INVENTORY', 'Stok dan bahan baku'],
  ['PROCUREMENT', 'Pembelian dan supplier'],
  ['MANAGER', 'Manajer: approval dan laporan'],
  ['ADMIN', 'Administrator sistem'],
  ['OWNER', 'Pemilik usaha'],
];

const USERS = [
  { role: 'ADMIN', emailKey: 'SEED_ADMIN_EMAIL', passwordKey: 'SEED_ADMIN_PASSWORD', nameKey: 'SEED_ADMIN_NAME', fallbackName: 'Administrator' },
  { role: 'MANAGER', emailKey: 'SEED_MANAGER_EMAIL', passwordKey: 'SEED_MANAGER_PASSWORD', nameKey: 'SEED_MANAGER_NAME', fallbackName: 'Manajer Operasional' },
  { role: 'CASHIER', emailKey: 'SEED_CASHIER_EMAIL', passwordKey: 'SEED_CASHIER_PASSWORD', nameKey: 'SEED_CASHIER_NAME', fallbackName: 'Kasir 1' },
  { role: 'KITCHEN', emailKey: 'SEED_KITCHEN_EMAIL', passwordKey: 'SEED_KITCHEN_PASSWORD', nameKey: 'SEED_KITCHEN_NAME', fallbackName: 'Chef Dapur' },
  { role: 'INVENTORY', emailKey: 'SEED_INVENTORY_EMAIL', passwordKey: 'SEED_INVENTORY_PASSWORD', nameKey: 'SEED_INVENTORY_NAME', fallbackName: 'Staff Inventory' },
];

// ---------------------------------------------------------------------------
// Data master: kategori, produk, meja
// ---------------------------------------------------------------------------

const CATEGORIES = [
  ['Makanan', 'Harian', ['Nasi Goreng Spesial', 'Mie Goreng', 'Ayam Bakar Madu', 'Soto Ayam', 'Rendang']],
  ['Minuman', 'Dingin dan hangat', ['Es Teh Manis', 'Kopi Susu', 'Jus Alpukat', 'Air Mineral']],
  ['Camilan', 'Camilan sisi', ['Kentang Goreng', 'Kerupuk Udang', 'Lumpia']],
  ['Dessert', 'Penutup', ['Es Kelapa Young', 'Pisang Cokelat']],
];

const PRODUCTS = [
  ['Makanan', 'MKN-001', 'Nasi Goreng Spesial', 'Nasi goreng ayam dengan telur, kecap, dan sambal matah.', 32000, ['Reguler', 'Jumbo']],
  ['Makanan', 'MKN-002', 'Mie Goreng', 'Mie goreng khas dengan ayam dan vegetable.', 28000, ['Ayam', 'Seafood']],
  ['Makanan', 'MKN-003', 'Ayam Bakar Madu', 'Ayam bakar dengan olesan madu dan kecap.', 42000, ['1/4 Ekor', '1/2 Ekor', '1 Ekar']],
  ['Makanan', 'MKN-004', 'Soto Ayam', 'Soto ayam bening khas Jawa.', 27000, ['Reguler']],
  ['Makanan', 'MKN-005', 'Rendang', 'Rendang sapi khas Sumatra Barat.', 48000, ['Reguler']],
  ['Minuman', 'MNM-001', 'Es Teh Manis', 'Teh manis dingin.', 8000, ['Reguler', 'Large']],
  ['Minuman', 'MNM-002', 'Kopi Susu', 'Kopi susu tanpa gula tambahan.', 18000, ['Hot', 'Iced']],
  ['Minuman', 'MNM-003', 'Jus Alpukat', 'Jus alpukat manis segar.', 22000, ['Reguler', 'Large']],
  ['Minuman', 'MNM-004', 'Air Mineral', 'Air minum dalam kemasan 600 ml.', 5000, []],
  ['Camilan', 'CMN-001', 'Kentang Goreng', 'Kentang goreng crippy dengan mayo.', 18000, ['Reguler', 'Jumbo']],
  ['Camilan', 'CMN-002', 'Kerupuk Udang', 'Kerupuk udang renyah.', 12000, []],
  ['Camilan', 'CMN-003', 'Lumpia', 'Lumpia goreng isi ayam dan vegetable.', 15000, []],
  ['Dessert', 'DST-001', 'Es Kelapa Young', 'Es kelapa muda dengan kelapa muda segar.', 20000, []],
  ['Dessert', 'DST-002', 'Pisang Cokelat', 'Pisang goreng dengan cokelat dan keju.', 17000, []],
];

// Tambahan harga varian (selisih terhadap harga dasar produk).
const VARIANT_PRICE_OFFSET = {
  Reguler: 0,
  Jumbo: 6000,
  Large: 5000,
  Hot: 0,
  Iced: 1000,
  Ayam: 5000,
  Seafood: 9000,
  '1/4 Ekor': 0,
  '1/2 Ekor': 22000,
  '1 Ekar': 45000,
};

const TABLES = [
  { code: 'A01', name: 'Meja A1', zone: 'A', capacity: 2 },
  { code: 'A02', name: 'Meja A2', zone: 'A', capacity: 4 },
  { code: 'A03', name: 'Meja A3', zone: 'A', capacity: 4 },
  { code: 'A04', name: 'Meja A4', zone: 'A', capacity: 6 },
  { code: 'B01', name: 'Meja B1', zone: 'B', capacity: 2 },
  { code: 'B02', name: 'Meja B2', zone: 'B', capacity: 2 },
  { code: 'B03', name: 'Meja B3', zone: 'B', capacity: 4 },
  { code: 'C01', name: 'Meja C1', zone: 'C', capacity: 8 },
  { code: 'C02', name: 'Meja C2', zone: 'C', capacity: 10 },
  { code: 'VIP1', name: 'VIP 1', zone: 'VIP', capacity: 6 },
];

// ---------------------------------------------------------------------------
// Data master: bahan baku dan recipe / BOM  (Fase 4)
// ---------------------------------------------------------------------------

/**
 * Bahan baku utama restoran.
 *
 * Stock awal sengaja dibuat cukup untuk mencoba beberapa dozen order
 * tanpa langsung menyentuh batas minimum. Stok awal dicatat sebagai mutasi
 * bertype PURCHASE supaya jurnal dan `ingredients.stock` selalu sinkron -
 * mengisi kolom stock lewat INSERT atau UPDATE langsung akan membuat keduanya berbeda.
 */
const INGREDIENTS = [
  // [kode, nama, unit, stok awal, stok minimum, harga per unit]
  //
  // SATUAN PENTING
  // Satuan bahan dipakai langsung oleh recipe. Karena itu takaran di recipe
  // harus memakai satuan yang sama. Contoh: Beras satuannya `kg`, maka
  // satu porsi nasi goreng memakai 0.150 (kg), bukan 150 (kg).
  ['BHN-001', 'Beras Pulen', 'kg', 25, 5, 16000],
  ['BHN-002', 'Telur Ayam', 'pcs', 240, 60, 2800],
  ['BHN-003', 'Ayam Potong', 'kg', 12, 3, 38000],
  ['BHN-004', 'Minyak Goreng', 'liter', 8, 2, 18000],
  ['BHN-005', 'Bumbu Rujak', 'gram', 12000, 3000, 120],
  ['BHN-006', 'Kecap Manis', 'ml', 10000, 2000, 45],
  ['BHN-007', 'Mi Instan', 'pack', 40, 10, 3200],
  ['BHN-008', 'Sayur Kangkung', 'kg', 6, 2, 9000],
  ['BHN-009', 'Kentang', 'kg', 15, 4, 14000],
  ['BHN-010', 'Udang Beku', 'gram', 6000, 2000, 420],
  ['BHN-011', 'Kecap Asin', 'ml', 8000, 2000, 30],
  ['BHN-012', 'Gula Pasir', 'kg', 5, 1, 17000],
  ['BHN-013', 'Susu Kental Manis', 'ml', 20000, 6000, 190],
  ['BHN-014', 'Alpukat', 'pcs', 20, 6, 28000],
  ['BHN-015', 'Pisang', 'kg', 8, 2, 26000],
  ['BHN-016', 'Es Krim', 'liter', 10, 3, 32000],
  ['BHN-017', 'Kentang Beku', 'kg', 10, 3, 13000],
  ['BHN-018', 'Mayones', 'ml', 6000, 2000, 340],
  ['BHN-019', 'Keju Cheddar', 'gram', 8000, 2000, 480],
  ['BHN-020', 'Cokelat Batang', 'gram', 10000, 3000, 290],
  ['BHN-021', 'Air Mineral Galon', 'bottle', 15, 4, 12000],
  ['BHN-022', 'Teh Celup', 'pack', 12, 3, 15000],
  ['BHN-023', 'Biji Kopi', 'gram', 3000, 1000, 950],
  ['BHN-024', 'Kelapa Muda', 'pcs', 15, 4, 18000],
  ['BHN-025', 'Ayam Bakar Mentah', 'kg', 10, 3, 40000],
  ['BHN-026', 'Daging Sapi', 'kg', 8, 2, 145000],
];

/**
 * Recipe / BOM per produk.
 *
 * key  = kode produk
 * value = { yield: jumlah porsi per batch, items: [kode bahan, takaran, waste%] }
 *
 * Takaran ditulis per SATU-unit yield, bukan per batch. Recipes di bawah
 * memakai yield 1 supaya angkanya sama persis dengan yang tertulis di
 * buku resep (mis. Nasi Goreng = 150 gram beras per porsi).
 */
const RECIPES = {
  // key  = kode produk
  // value = { yield: porsi per batch, items: [kode bahan, takaran per porsi, waste%] }
  //
  // SATUAN WAJIB COCOK dengan satuan bahan di INGREDIENTS.
  // Beras satuannya kg, jadi 0.150 berarti 150 gram.
  'MKN-001': {
    // Nasi Goreng Spesial
    yield: 1,
    items: [
      ['BHN-001', 0.15, 2],
      ['BHN-002', 1, 0],
      ['BHN-003', 0.05, 10],
      ['BHN-004', 0.01, 0],
      ['BHN-005', 15, 5],
    ],
  },
  'MKN-002': {
    // Mie Goreng
    yield: 1,
    items: [
      ['BHN-007', 1, 5],
      ['BHN-003', 0.045, 10],
      ['BHN-008', 0.04, 20],
      ['BHN-004', 0.01, 0],
      ['BHN-006', 10, 5],
    ],
  },
  'MKN-003': {
    // Ayam Bakar Madu - berbasis 1/4 ekor (300 gram)
    yield: 1,
    items: [
      ['BHN-025', 0.3, 5],
      ['BHN-006', 15, 5],
      ['BHN-005', 10, 5],
    ],
  },
  'MKN-004': {
    // Soto Ayam
    yield: 1,
    items: [
      ['BHN-003', 0.06, 10],
      ['BHN-008', 0.05, 20],
      ['BHN-001', 0.02, 2],
      ['BHN-005', 12, 5],
    ],
  },
  'MKN-005': {
    // Rendang
    yield: 1,
    items: [
      ['BHN-026', 0.18, 5],
      ['BHN-012', 0.025, 0],
      ['BHN-005', 20, 5],
    ],
  },
  'MNM-001': { yield: 1, items: [['BHN-012', 0.012, 0]] },
  'MNM-002': { yield: 1, items: [['BHN-023', 15, 5], ['BHN-013', 20, 0]] },
  'MNM-003': { yield: 1, items: [['BHN-014', 1, 15], ['BHN-012', 0.01, 0]] },
  'MNM-004': { yield: 1, items: [['BHN-021', 1, 0]] },
  'CMN-001': {
    yield: 1,
    items: [
      ['BHN-009', 0.15, 10],
      ['BHN-004', 0.015, 0],
      ['BHN-012', 0.005, 0],
    ],
  },
  'CMN-002': { yield: 1, items: [['BHN-010', 60, 0], ['BHN-004', 0.01, 0]] },
  'CMN-003': {
    yield: 1,
    items: [
      ['BHN-017', 0.08, 5],
      ['BHN-003', 0.04, 10],
      ['BHN-008', 0.03, 20],
      ['BHN-004', 0.01, 0],
    ],
  },
  'DST-001': { yield: 1, items: [['BHN-024', 1, 20]] },
  'DST-002': {
    yield: 1,
    items: [
      ['BHN-015', 0.12, 15],
      ['BHN-020', 20, 5],
      ['BHN-004', 0.01, 0],
    ],
  },
};

/** Helper: cari id berdasarkan kolom dan nilai. */
async function findIdByField(conn, table, column, value) {
  const [rows] = await conn.execute(
    `SELECT id FROM \`${table}\` WHERE \`${column}\` = ? LIMIT 1`,
    [value]
  );
  return rows.length ? rows[0].id : null;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function findIdByCode(conn, table, code) {
  const [rows] = await conn.execute(
    `SELECT id FROM \`${table}\` WHERE code = ? LIMIT 1`,
    [code]
  );
  return rows.length ? rows[0].id : null;
}

/**
 * Ambil id kategori berdasarkan nama. `table` dan `column` di-hardcode di sini
 * sehingga tidak ada input user yang masuk ke nama kolom.
 */
async function findIdByName(conn, table, column, name) {
  const [rows] = await conn.execute(
    `SELECT id FROM \`${table}\` WHERE \`${column}\` = ? LIMIT 1`,
    [name]
  );
  return rows.length ? rows[0].id : null;
}

// ---------------------------------------------------------------------------
// Langkah seed
// ---------------------------------------------------------------------------

async function seedRoles(conn) {
  const roleIds = {};
  for (const [name, description] of ROLES) {
    await conn.execute(
      `INSERT INTO roles (name, description, is_system)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE description = VALUES(description)`,
      [name, description, name === 'ADMIN' ? 1 : 0]
    );
    roleIds[name] = await findIdByName(conn, 'roles', 'name', name);
  }
  console.log(`  roles            : ${ROLES.length}`);
  return roleIds;
}

async function seedPermissions(conn) {
  const permissionIds = {};
  for (const [code, module, action, description] of PERMISSIONS) {
    await conn.execute(
      `INSERT INTO permissions (code, module, action, description)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         module = VALUES(module),
         action = VALUES(action),
         description = VALUES(description)`,
      [code, module, action, description]
    );
    const id = await findIdByName(conn, 'permissions', 'code', code);
    permissionIds[code] = id;
  }
  console.log(`  permissions      : ${PERMISSIONS.length}`);
  return permissionIds;
}

async function seedRolePermissions(conn, roleIds, permissionIds) {
  let total = 0;
  for (const [roleName, codes] of Object.entries(ROLE_PERMISSIONS)) {
    const list = codes === null ? Object.keys(permissionIds) : codes;
    for (const code of list) {
      const permissionId = permissionIds[code];
      if (!permissionId) continue;
      await conn.execute(
        `INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`,
        [roleIds[roleName], permissionId]
      );
      total += 1;
    }
  }
  console.log(`  role_permissions : ${total}`);
}

async function seedUsers(conn, roleIds) {
  for (const { role, emailKey, passwordKey, nameKey, fallbackName } of USERS) {
    const email = process.env[emailKey] || `${role.toLowerCase()}@restaurant.test`;
    const password = process.env[passwordKey] || 'Password123!';
    const name = process.env[nameKey] || fallbackName;

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    await conn.execute(
      `INSERT INTO users (name, email, password_hash, status)
       VALUES (?, ?, ?, 'ACTIVE')
       ON DUPLICATE KEY UPDATE name = VALUES(name), status = 'ACTIVE'`,
      [name, email, hash]
    );

    const userId = await findIdByName(conn, 'users', 'email', email);
    await conn.execute(
      `INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)`,
      [userId, roleIds[role]]
    );
    console.log(`  user             : ${email} / ${password}  [${role}]`);
  }
}

async function seedCategories(conn) {
  for (let index = 0; index < CATEGORIES.length; index += 1) {
    const [name, description] = CATEGORIES[index];
    await conn.execute(
      `INSERT INTO categories (name, description, sort_order)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE description = VALUES(description), sort_order = VALUES(sort_order)`,
      [name, description, (index + 1) * 10]
    );
  }
  console.log(`  categories       : ${CATEGORIES.length}`);
}

async function seedProducts(conn) {
  for (const [categoryName, code, name, description, price, variants] of PRODUCTS) {
    const categoryId = await findIdByName(conn, 'categories', 'name', categoryName);
    if (!categoryId) continue;

    await conn.execute(
      `INSERT INTO products (category_id, code, name, description, price)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         category_id = VALUES(category_id),
         name = VALUES(name),
         description = VALUES(description),
         price = VALUES(price)`,
      [categoryId, code, name, description, price]
    );

    const productId = await findIdByCode(conn, 'products', code);
    for (let index = 0; index < variants.length; index += 1) {
      const variantName = variants[index];
      const offset = VARIANT_PRICE_OFFSET[variantName] ?? 0;
      await conn.execute(
        `INSERT INTO product_variants (product_id, name, price, is_default, sort_order)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           price = VALUES(price),
           sort_order = VALUES(sort_order)`,
        [productId, variantName, price + offset, index === 0 ? 1 : 0, (index + 1) * 10]
      );
    }
  }
  console.log(`  products         : ${PRODUCTS.length}`);
}

async function seedAddons(conn) {
  const addonMap = {
    Makanan: [
      ['Telur Balado', 4000],
      ['Sambal Matah', 3000],
      ['Kerupuk', 2000],
      ['Nasi Putih', 5000],
    ],
    Minuman: [
      ['Es Tawar', 2000],
      ['Sedotan', 1000],
    ],
    Camilan: [['Mayo Extra', 3000], ['Keju Susu', 4000]],
    Dessert: [['Madu', 3000]],
  };

  let total = 0;
  for (const [categoryName, addons] of Object.entries(addonMap)) {
    const categoryId = await findIdByName(conn, 'categories', 'name', categoryName);
    if (!categoryId) continue;

    for (const [name, price] of addons) {
      const existing = await findIdByName(conn, 'product_addons', 'name', name);
      if (existing) continue;
      await conn.execute(
        `INSERT INTO product_addons (category_id, name, price) VALUES (?, ?, ?)`,
        [categoryId, name, price]
      );
      total += 1;
    }
  }
  console.log(`  product_addons   : ${total}`);
}

/**
 * Seed bahan baku.
 *
 * Stok awal dicatat lewat INSERT langsung ke ingredients DAN jurnal PURCHASE
 * di waktu yang sama. Kalau hanya mengisi kolom stock, nilainya akan berbeda
 * dari riwayat mutasi - dan sistem tidak bisa dipertanggungjawabkan.
 */
async function seedIngredients(conn) {
  let created = 0;

  for (const [code, name, unit, stock, minimumStock, unitPrice] of INGREDIENTS) {
    const existing = await findIdByCode(conn, 'ingredients', code);
    if (existing) continue;

    const [result] = await conn.execute(
      `INSERT INTO ingredients (code, name, unit, stock, minimum_stock, unit_price)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [code, name, unit, stock, minimumStock, unitPrice]
    );

    // Jurnal pembuka supaya angka stok selalu bisa ditelusuri.
    await conn.execute(
      `INSERT INTO inventory_transactions
         (ingredient_id, type, quantity_in, quantity_out, stock_before, stock_after,
          reference_type, reference_id, note)
       VALUES (?, 'PURCHASE', ?, 0, 0, ?, 'manual', NULL, 'Stok awal dari seed')`,
      [result.insertId, stock, stock]
    );

    created += 1;
  }

  console.log(`  ingredients      : ${created} baru dari ${INGREDIENTS.length} total`);
  return created;
}

/**
 * Seed recipe / BOM.
 *
 * Takaran per satu porsi. Waste dihitung terpisah oleh recipe.service saat
 * terjadi penjualan, jadi di sini cukup menyimpan angka dasarnya.
 */
async function seedRecipes(conn) {
  let created = 0;
  let skipped = 0;

  for (const [productCode, recipe] of Object.entries(RECIPES)) {
    const productId = await findIdByCode(conn, 'products', productCode);
    if (!productId) {
      console.warn(`  recipe dilewati, produk ${productCode} tidak ditemukan`);
      continue;
    }

    const existing = await findIdByField(conn, 'recipes', 'product_id', productId);
    if (existing) {
      skipped += 1;
      continue;
    }

    const [result] = await conn.execute(
      `INSERT INTO recipes (product_id, name, yield_quantity, note)
       VALUES (?, ?, ?, ?)`,
      [
        productId,
        `Recipe ${productCode}`,
        recipe.yield,
        'Komposisi standar restoran',
      ]
    );

    for (const [ingredientCode, quantity, wastePercent] of recipe.items) {
      const ingredientId = await findIdByCode(conn, 'ingredients', ingredientCode);
      if (!ingredientId) {
        console.warn(`  bahan ${ingredientCode} tidak ditemukan, dilewati`);
        continue;
      }

      await conn.execute(
        `INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, waste_percent)
         VALUES (?, ?, ?, ?)`,
        [result.insertId, ingredientId, quantity, wastePercent]
      );
    }

    created += 1;
  }

  console.log(`  recipes          : ${created} dibuat, ${skipped} sudah ada`);
  return created;
}

async function seedTables(conn) {
  for (const table of TABLES) {
    await conn.execute(
      `INSERT INTO restaurant_tables (code, name, zone, capacity)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         zone = VALUES(zone),
         capacity = VALUES(capacity)`,
      [table.code, table.name, table.zone, table.capacity]
    );

    const tableId = await findIdByCode(conn, 'restaurant_tables', table.code);
    const [existing] = await conn.execute(
      `SELECT id FROM table_qr_codes WHERE table_id = ? AND is_active = 1 LIMIT 1`,
      [tableId]
    );
    if (existing.length === 0) {
      await conn.execute(
        `INSERT INTO table_qr_codes (table_id, token, label) VALUES (?, ?, ?)`,
        [tableId, nanoid(32), `QR ${table.code}`]
      );
    }
  }
  console.log(`  restaurant_tables: ${TABLES.length} (beserta QR code)`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function seed() {
  console.log('Menjalankan seed data...\n');

  const info = await testConnection();
  console.log(`  terhubung ke     : ${info.db} (${info.version})\n`);

  // Tabel Fase 4 harus ada sebelum seed bahan baku dijalankan.
  const hasInventory = await tableExists(info.db, 'ingredients');
  if (!hasInventory) {
    console.warn('  Tabel inventory belum ada. Jalankan "npm run migrate:phase4" lebih dulu.');
    console.warn('  Seed bahan baku dan recipe dilewati.');
  }

  await withTransaction(async (conn) => {
    console.log('Menulis data master:');
    const roleIds = await seedRoles(conn);
    const permissionIds = await seedPermissions(conn);
    await seedRolePermissions(conn, roleIds, permissionIds);
    await seedUsers(conn, roleIds);
    await seedCategories(conn);
    await seedProducts(conn);
    await seedAddons(conn);
    await seedTables(conn);

    if (hasInventory) {
      await seedIngredients(conn);
      await seedRecipes(conn);
    }
  });

  console.log('\nSeed selesai. Kredensial demo sudah dicetak di atas.');
}

/**
 * Cek apakah sebuah tabel sudah ada di database aktif.
 * Dipakai agar seed tetap jalan di instalasi Fase 1-3 yang belum menjalankan
 * migrasi Fase 4.
 */
async function tableExists(databaseName, tableName) {
  const [rows] = await query(
    `SELECT COUNT(*) AS total
       FROM information_schema.tables
      WHERE table_schema = ? AND table_name = ?`,
    [databaseName, tableName]
  );
  return rows[0].total > 0;
}

if (require.main === module) {
  seed()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async (error) => {
      console.error('\nSeed GAGAL:');
      console.error(error.message);
      await closePool();
      process.exit(1);
    });
}

module.exports = { seed, PERMISSIONS, ROLE_PERMISSIONS };
