'use strict';

/**
 * Entry point server produksi.
 *
 * Tugas berkas ini hanya:
 *   1. membangun HTTP + Socket.IO lewat bootstrap.js
 *   2. memastikan database terjangkau
 *   3. menjalankan graceful shutdown
 *
 * Seluruh konfigurasi HTTP dan realtime ada di bootstrap.js supaya bisa dipakai
 * ulang oleh integration test tanpa perbedaan perilaku.
 */

const config = require('./config/env');
const { createServer, closeServer } = require('./bootstrap');
const { testConnection } = require('./config/database');

const { server, io } = createServer();

let shuttingDown = false;

/**
 * @param {number} [code]
 */
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nMematikan server...');

  try {
    await closeServer({ server, io });
    console.log('Server dan koneksi database ditutup.');
  } catch (error) {
    console.error('Gagal menutup dengan rapi:', error.message);
  }

  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  shutdown(1);
});

async function start() {
  try {
    const info = await testConnection();
    console.log(`Database terhubung: ${info.db} (${info.version})`);
  } catch (error) {
    console.error('Gagal terhubung ke database:', error.message);
    console.error('Pastikan MySQL/MariaDB sudah berjalan dan isi .env dengan benar.');
    process.exit(1);
  }

  server.listen(config.port, () => {
    console.log('');
    console.log(`  ${config.appName}`);
    console.log(`  Server      : http://localhost:${config.port}`);
    console.log(`  API         : http://localhost:${config.port}/api`);
    console.log(`  Health      : http://localhost:${config.port}/health`);
    console.log(`  QR base     : ${config.publicBaseUrl}`);
    console.log(`  Environment : ${config.nodeEnv}`);
    console.log('');
    console.log('  Halaman     : /index.html  /menu.html  /cashier.html');
    console.log('                /kitchen.html  /dashboard.html  /admin-inventory.html');
    console.log('');
  });
}

if (require.main === module) {
  start();
}

module.exports = { server, io, start, shutdown };