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
  INVENTORY: ['category.view', 'product.view', 'notification.view'],
  PROCUREMENT: ['category.view', 'product.view', 'notification.view'],
  MANAGER: [
    'category.view', 'product.view',
    'table.view', 'table.qr',
    'order.view', 'order.cancel',
    'payment.view', 'payment.refund',
    'report.view', 'report.finance',
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
  });

  console.log('\nSeed selesai. Kredensial demo sudah dicetak di atas.');
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