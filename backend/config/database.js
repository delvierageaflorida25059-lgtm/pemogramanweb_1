'use strict';

/**
 * Konfigurasi koneksi database (mysql2).
 *
 * Modul ini mengekspor tiga hal:
 *   - pool          : connection pool MySQL / MariaDB
 *   - query()       : helper untuk query parameterized
 *   - withTransaction(): helper untuk transaksi atomic
 *
 * PENTING: seluruh query di proyek ini wajib memakai placeholder `?`.
 * Jangan pernah menempelkan input user langsung ke string SQL.
 */

const mysql = require('mysql2/promise');
const config = require('./env');

const config_ = {
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.name,
  waitForConnections: true,
  connectionLimit: config.db.connectionLimit,
  queueLimit: 0,
  charset: 'utf8mb4_unicode_ci',
  // DECIMAL dikembalikan sebagai Number agar bisa dihitung langsung di JS.
  decimalNumbers: true,
  // DATETIME dikembalikan sebagai string agar tidak ada pergeseran zona waktu
  // antara nilai yang disimpan MySQL dan nilai yang ditampilkan di browser.
  dateStrings: true,
};

const pool = mysql.createPool(config_);

/** true bila koneksi database berhasil dijangkau. */
async function testConnection() {
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.query('SELECT VERSION() AS version, DATABASE() AS db');
    return rows[0];
  } finally {
    connection.release();
  }
}

/**
 * Jalankan satu query parameterized.
 * @param {string} sql
 * @param {Array<any>} params
 * @returns {Promise<import('mysql2/promise').QueryResult>}
 */
async function query(sql, params = []) {
  return pool.execute(sql, params);
}

/**
 * Query biasa (bukan prepared statement) - dipakai script migrasi/seed
 * yang memang menjalankan banyak statement SQL dari file.
 */
async function raw(sql) {
  return pool.query(sql);
}

/**
 * Jalankan callback di dalam transaksi.
 * Semua query di dalam callback harus memakai `conn`, bukan helper `query`,
 * supaya semuanya berada pada koneksi yang sama.
 *
 * @template T
 * @param {(conn: import('mysql2/promise').PoolConnection) => Promise<T>} callback
 * @returns {Promise<T>}
 */
async function withTransaction(callback) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function closePool() {
  await pool.end();
}

module.exports = {
  pool,
  query,
  raw,
  withTransaction,
  testConnection,
  closePool,
  dbConfig: { ...config_ },
};