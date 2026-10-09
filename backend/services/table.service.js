'use strict';

const { nanoid } = require('nanoid');
const { query } = require('../config/database');
const ApiError = require('../utils/ApiError');
const config = require('../config/env');

/**
 * Service meja restoran dan QR code-nya.
 *
 * Prinsip QR (sesuai blueprint): QR hanya membawa TOKEN, bukan data menu
 * atau harga. Token dicocokkan ke database, lalu browser diarahkan ke halaman
 * menu dengan parameter meja. Dengan begitu harga tetap controlled dari server
 * dan QR lama tetap berlaku meski menu berubah.
 */

const VALID_STATUSES = ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'DISABLED'];

/**
 * @param {object} [filters]
 * @param {string} [filters.status]
 * @param {string} [filters.zone]
 * @param {boolean} [filters.activeOnly]
 */
async function list(filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.status) {
    conditions.push('t.status = ?');
    params.push(filters.status);
  }
  if (filters.zone) {
    conditions.push('t.zone = ?');
    params.push(filters.zone);
  }
  if (filters.activeOnly) conditions.push('t.is_active = 1');

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await query(
    `SELECT t.id, t.code, t.name, t.zone, t.capacity, t.status, t.is_active,
            t.created_at, t.updated_at,
            q.id AS qr_id, q.token AS qr_token, q.is_active AS qr_active,
            (SELECT COUNT(*) FROM orders o
              WHERE o.table_id = t.id
                AND o.status NOT IN ('COMPLETED', 'CANCELLED')) AS active_order_count
       FROM restaurant_tables t
       LEFT JOIN table_qr_codes q
              ON q.table_id = t.id AND q.is_active = 1 AND q.revoked_at IS NULL
       ${where}
      ORDER BY t.zone ASC, t.code ASC`,
    params
  );

  return rows.map((row) => ({
    id: Number(row.id),
    code: row.code,
    name: row.name,
    zone: row.zone,
    capacity: Number(row.capacity),
    status: row.status,
    is_active: Boolean(row.is_active),
    qr: row.qr_token
      ? { id: Number(row.qr_id), token: row.qr_token, is_active: Boolean(row.qr_active) }
      : null,
    activeOrderCount: Number(row.active_order_count),
  }));
}

/** @param {number} id */
async function findById(id) {
  const tables = await list();
  return tables.find((table) => table.id === Number(id)) || null;
}

/** @param {string} code */
async function findByCode(code) {
  const [rows] = await query(
    `SELECT id, code, name, zone, capacity, status, is_active
       FROM restaurant_tables
      WHERE code = ?
      LIMIT 1`,
    [code]
  );
  if (rows.length === 0) return null;
  return {
    id: Number(rows[0].id),
    code: rows[0].code,
    name: rows[0].name,
    zone: rows[0].zone,
    capacity: Number(rows[0].capacity),
    status: rows[0].status,
    is_active: Boolean(rows[0].is_active),
  };
}

/** @param {object} data */
async function create(data) {
  const status = VALID_STATUSES.includes(data.status) ? data.status : 'AVAILABLE';
  const [result] = await query(
    `INSERT INTO restaurant_tables (code, name, zone, capacity, status, is_active)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      data.code,
      data.name || `Meja ${data.code}`,
      data.zone ?? null,
      data.capacity ?? 4,
      status,
      data.is_active === false ? 0 : 1,
    ]
  );

  const tableId = result.insertId;
  await issueQr(tableId, `QR ${data.code}`);
  return findById(tableId);
}

/**
 * @param {number} id
 * @param {object} data
 */
async function update(id, data) {
  const existing = await findById(id);
  if (!existing) throw ApiError.notFound('Meja tidak ditemukan.');

  const updates = [];
  const params = [];

  if (data.code !== undefined) { updates.push('code = ?'); params.push(data.code); }
  if (data.name !== undefined) { updates.push('name = ?'); params.push(data.name); }
  if (data.zone !== undefined) { updates.push('zone = ?'); params.push(data.zone || null); }
  if (data.capacity !== undefined) { updates.push('capacity = ?'); params.push(data.capacity); }
  if (data.status !== undefined) {
    if (!VALID_STATUSES.includes(data.status)) {
      throw ApiError.badRequest(`Status meja harus salah satu dari: ${VALID_STATUSES.join(', ')}.`);
    }
    updates.push('status = ?');
    params.push(data.status);
  }
  if (data.is_active !== undefined) { updates.push('is_active = ?'); params.push(data.is_active ? 1 : 0); }

  if (updates.length > 0) {
    params.push(id);
    await query(`UPDATE restaurant_tables SET ${updates.join(', ')} WHERE id = ?`, params);
  }

  return findById(id);
}

/**
 * @param {number} id
 */
async function remove(id) {
  const [orderRows] = await query(
    `SELECT COUNT(*) AS total FROM orders WHERE table_id = ?`,
    [id]
  );
  if (orderRows[0].total > 0) {
    throw ApiError.conflict(
      'Meja sudah pernah dipakai pada transaksi. Nonaktifkan meja, bukan hapus.'
    );
  }

  const [result] = await query(`DELETE FROM restaurant_tables WHERE id = ?`, [id]);
  if (result.affectedRows === 0) throw ApiError.notFound('Meja tidak ditemukan.');
  return { id: Number(id) };
}

// ---------------------------------------------------------------------------
// QR code
// ---------------------------------------------------------------------------

/**
 * Buat token QR baru untuk sebuah meja.
 * Token lama dicabut, bukan dihapus, supaya QR cetakan lama bisa dilacak.
 *
 * @param {number} tableId
 * @param {string} [label]
 */
async function issueQr(tableId, label = null) {
  const table = await findById(tableId);
  if (!table) throw ApiError.notFound('Meja tidak ditemukan.');

  await query(
    `UPDATE table_qr_codes SET is_active = 0, revoked_at = NOW()
      WHERE table_id = ? AND revoked_at IS NULL`,
    [tableId]
  );

  const token = nanoid(32);
  await query(
    `INSERT INTO table_qr_codes (table_id, token, label) VALUES (?, ?, ?)`,
    [tableId, token, label || `QR ${table.code}`]
  );

  return { tableId, token, url: buildQrUrl(token) };
}

/**
 * URL yang dipindai pelanggan.
 * @param {string} token
 */
function buildQrUrl(token) {
  return `${config.publicBaseUrl}/menu.html?token=${token}`;
}

/**
 * Resolusi token QR menjadi data meja.
 * Dipanggil endpoint publik saat pelanggan memindai QR.
 *
 * @param {string} token
 * @returns {Promise<object|null>}
 */
async function resolveToken(token) {
  const [rows] = await query(
    `SELECT q.id AS qr_id, q.scan_count,
            t.id, t.code, t.name, t.zone, t.capacity, t.status, t.is_active
       FROM table_qr_codes q
       JOIN restaurant_tables t ON t.id = q.table_id
      WHERE q.token = ?
        AND q.is_active = 1
        AND q.revoked_at IS NULL
        AND t.is_active = 1
      LIMIT 1`,
    [token]
  );

  if (rows.length === 0) return null;

  await query(`UPDATE table_qr_codes SET scan_count = scan_count + 1 WHERE id = ?`, [
    rows[0].qr_id,
  ]);

  return {
    id: Number(rows[0].id),
    code: rows[0].code,
    name: rows[0].name,
    zone: rows[0].zone,
    capacity: Number(rows[0].capacity),
    status: rows[0].status,
    scanCount: Number(rows[0].scan_count) + 1,
  };
}

/**
 * Semua QR aktif, untuk halaman admin yang butuh mencetak QR semua meja.
 */
async function listActiveQrCodes() {
  const tables = await list({ activeOnly: true });
  return tables
    .filter((table) => table.qr)
    .map((table) => ({
      tableId: table.id,
      tableCode: table.code,
      tableName: table.name,
      token: table.qr.token,
      url: buildQrUrl(table.qr.token),
    }));
}

module.exports = {
  list,
  findById,
  findByCode,
  create,
  update,
  remove,
  issueQr,
  resolveToken,
  listActiveQrCodes,
  buildQrUrl,
  VALID_STATUSES,
};