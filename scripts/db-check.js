/**
 * Pemeriksaan kondisi database secara read-only.
 *
 * Script ini tidak pernah menjalankan DDL maupun DML, jadi aman dipakai
 * untuk memastikan database lokal sudah siap sebelum migrate atau seed.
 *
 * Jalankan: node scripts/db-check.js
 */
const db = require('../backend/config/database');

const TABLES = [
  'users',
  'roles',
  'permissions',
  'role_permissions',
  'customers',
  'categories',
  'products',
  'product_variants',
  'product_addons',
  'restaurant_tables',
  'table_qr_codes',
  'orders',
  'order_items',
  'order_item_addons',
  'order_status_history',
  'payments',
  'notifications',
  'audit_logs',
  'ingredients',
  'recipes',
  'recipe_items',
  'inventory_transactions',
  'stock_opnames',
  'stock_opname_items',
];

async function main() {
  try {
    const [info] = await db.query(
      'SELECT VERSION() AS version, DATABASE() AS db, @@port AS port, @@character_set_database AS charset'
    );
    const row = info[0];
    console.log('Koneksi  : OK');
    console.log('Server   :', row.version);
    console.log('Database :', row.db);
    console.log('Port     :', row.port);
    console.log('Charset  :', row.charset);

    const [countRows] = await db.query(
      'SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE()'
    );
    const total = Number(countRows[0].total);
    console.log('\nTabel    :', total, 'dari', TABLES.length, 'tabel aplikasi');

    const [existing] = await db.query(
      'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()'
    );
    const existingNames = new Set(existing.map((r) => r.name));

    console.log('\nJumlah baris per tabel:');
    for (const table of TABLES) {
      if (!existingNames.has(table)) {
        console.log('  ' + table.padEnd(24) + 'HILANG');
        continue;
      }
      const [rows] = await db.query('SELECT COUNT(*) AS total FROM `' + table + '`');
      console.log('  ' + table.padEnd(24) + Number(rows[0].total));
    }

    const missing = TABLES.filter((t) => !existingNames.has(t));
    if (missing.length > 0) {
      console.log('\nTabel belum ada:', missing.join(', '));
      console.log('Jalankan: npm run migrate   (hapus DB lama)');
      console.log('atau    : npm run migrate:phase4  (hanya tambah tabel Inventory)');
    }
  } catch (error) {
    console.log('Koneksi  : GAGAL');
    console.log('Kode     :', error.code || '(tidak ada)');
    console.log('Pesan    :', error.message);
    process.exitCode = 1;
  } finally {
    await db.closePool();
  }
}

main();
