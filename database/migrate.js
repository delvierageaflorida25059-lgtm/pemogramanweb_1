'use strict';

/**
 * Runner migrasi database.
 *
 * Menjalankan database/schema.sql yang berisi CREATE DATABASE + CREATE TABLE.
 * Karena file schema.sql bersifat destruktif (DROP DATABASE), setiap
 * eksekusi meminta konfirmasi kecuali diberi flag --force.
 *
 * Pemakaian:
 *   node database/migrate.js           -> tanya konfirmasi lalu jalankan
 *   node database/migrate.js --force   -> langsung jalankan tanpa tanya
 */

const fs = require('fs/promises');
const path = require('path');
const readline = require('readline');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

/**
 * Pisahkan file SQL menjadi statement individual.
 * Diawali dengan satu atau dua karakter '-' (--), dengan atau tanpa spasi.
 * Pemisahan dilakukan per baris supaya comment inline `SELECT 1; -- x`
 * ikut terpotong dengan benar.
 */
function splitStatements(sql) {
  const withoutComments = sql
    .split(/\r?\n/)
    .filter((line) => !/^\s*--/.test(line))
    .join('\n');

  return withoutComments
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function askConfirmation(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function migrate({ force = false } = {}) {
  const sql = await fs.readFile(SCHEMA_PATH, 'utf8');
  const statements = splitStatements(sql);

  if (statements.length === 0) {
    throw new Error(`Tidak ada statement SQL yang bisa dijalankan di ${SCHEMA_PATH}`);
  }

  if (!force) {
    console.log('PERINGATAN: migrasi akan MENGHAPUS database lama beserta seluruh isinya.');
    const answer = await askConfirmation('Lanjutkan? (ketik "ya" untuk lanjut): ');
    if (answer !== 'ya') {
      console.log('Migrasi dibatalkan oleh pengguna.');
      process.exit(0);
    }
  }

  // Koneksi sengaja dibuat tanpa `database` supaya bisa membuat database baru.
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD ?? '',
    multipleStatements: false,
    charset: 'utf8mb4_unicode_ci',
  });

  let executed = 0;
  try {
    for (const statement of statements) {
      await connection.query(statement);
      executed += 1;
    }
    console.log(`Migrasi selesai. ${executed} statement berhasil dijalankan.`);
    console.log(`Database "${process.env.DB_NAME || 'restaurant_management'}" siap dipakai.`);
  } catch (error) {
    console.error('\nMigrasi GAGAL pada statement ke-' + executed);
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  migrate({ force: process.argv.includes('--force') }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { migrate, splitStatements };