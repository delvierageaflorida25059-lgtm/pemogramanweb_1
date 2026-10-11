'use strict';

/**
 * Service bahan baku (ingredients).
 *
 * ATURAN PENTING
 * Kolom `ingredients.stock` TIDAK BOLEH diubah langsung lewat UPDATE.
 * Semua perubahan stok harus melalui inventory.service, yang juga menulis
 * jurnal ke tabel inventory_transactions. Kalau stok bisa diubah diam-diam,
 * riwayat dan angka saat ini akan berbeda - dan sistem tidak bisa dipertanggungjawabkan.
 *
 * Modul ini hanya mengurus data master (kode, nama, satuan, harga, batas minimum).
 */

const { query } = require('../config/database');
const ApiError = require('../utils/ApiError');
const { round } = require('../utils/money');

/** Satuan yang didukung. */
const UNITS = ['gram', 'kg', 'ml', 'liter', 'pcs', 'pack', 'bottle', 'cans'];

/** Konversi ke satuan dasar per satuan induk. */
const UNIT_BASE = {
  gram: { base: 'gram', factor: 1 },
  kg: { base: 'gram', factor: 1000 },
  ml: { base: 'ml', factor: 1 },
  liter: { base: 'ml', factor: 1000 },
  pcs: { base: 'pcs', factor: 1 },
  pack: { base: 'pcs', factor: 1 },
  bottle: { base: 'pcs', factor: 1 },
  cans: { base: 'pcs', factor: 1 },
};

/** Tiga desimal sudah lebih dari cukup untuk satuan gram dan mililiter. */
const QTY_DECIMALS = 3;

/**
 * Ubah jumlah ke satuan dasar bahan.
 * Dipakai saat membandingkan atau menjumlahkan takaran antar bahan.
 *
 * @param {number} quantity
 * @param {string} unit
 * @returns {number}
 */
function toBaseUnit(quantity, unit) {
  const info = UNIT_BASE[unit] || UNIT_BASE.gram;
  return round(toNumber(quantity) * info.factor, QTY_DECIMALS);
}

/** @param {any} value @param {number} [fallback=0] */
function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * Daftar bahan baku.
 *
 * @param {object} [filters]
 * @param {string} [filters.search]
 * @param {boolean} [filters.activeOnly]
 * @param {boolean} [filters.lowStockOnly]  hanya yang menyentuh batas minimum
 * @param {number} [filters.limit]
 * @param {number} [filters.offset]
 * @returns {Promise<{rows:object[], total:number}>}
 */
async function list(filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.activeOnly) conditions.push('is_active = 1');
  if (filters.search) {
    conditions.push('(name LIKE ? OR code LIKE ?)');
    const keyword = `%${filters.search}%`;
    params.push(keyword, keyword);
  }
  // Hanya bahan yang batas minimumnya benar-benar diatur (> 0) yang bisa disebut "menipis".
  if (filters.lowStockOnly) {
    conditions.push('minimum_stock > 0 AND stock <= minimum_stock');
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRows] = await query(
    `SELECT COUNT(*) AS total FROM ingredients ${where}`,
    params
  );

  const [rows] = await query(
    `SELECT id, code, name, unit, stock, minimum_stock, unit_price,
            supplier_id, is_active, created_at, updated_at
       FROM ingredients
       ${where}
      ORDER BY name ASC
      LIMIT ? OFFSET ?`,
    [...params, filters.limit ?? 100, filters.offset ?? 0]
  );

  return { rows: rows.map(decorate), total: countRows[0].total };
}

/**
 * Ambil bahan berdasarkan id.
 * @param {number} id
 */
async function findById(id) {
  const [rows] = await query(
    `SELECT id, code, name, unit, stock, minimum_stock, unit_price,
            supplier_id, is_active, created_at, updated_at
       FROM ingredients
      WHERE id = ?
      LIMIT 1`,
    [id]
  );
  return rows.length ? decorate(rows[0]) : null;
}

/**
 * Ambil beberapa bahan sekaligus dalam satu query.
 * Dipakai saat menghitung kebutuhan bahan sebuah order.
 *
 * @param {number[]} ids
 * @returns {Promise<Map<number, object>>}
 */
async function findByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return new Map();

  const [rows] = await query(
    `SELECT id, code, name, unit, stock, minimum_stock, unit_price, is_active
       FROM ingredients
      WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids
  );
  return new Map(rows.map((row) => [Number(row.id), decorate(row)]));
}

/**
 * Ambil bahan berdasarkan id dengan baris terkunci (SELECT ... FOR UPDATE).
 * Dipakai di dalam transaksi supaya dua kasir tidak mengurangi bahan yang
 * sama secara bersamaan.
 *
 * @param {import('mysql2/promise').PoolConnection} conn
 * @param {number} id
 * @returns {Promise<object|null>}
 */
async function findByIdForUpdate(conn, id) {
  const [rows] = await conn.execute(
    `SELECT id, code, name, unit, stock, minimum_stock
       FROM ingredients
      WHERE id = ?
      FOR UPDATE`,
    [id]
  );
  return rows.length ? decorate(rows[0]) : null;
}

/**
 * @param {object} data
 * @returns {Promise<object>}
 */
async function create(data) {
  if (!UNITS.includes(data.unit)) {
    throw ApiError.badRequest(`Satuan harus salah satu dari: ${UNITS.join(', ')}.`);
  }
  if (round(toNumber(data.stock)) < 0) {
    throw ApiError.badRequest('Stok awal tidak boleh negatif.');
  }

  const [result] = await query(
    `INSERT INTO ingredients (code, name, unit, stock, minimum_stock, unit_price, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      data.code,
      data.name,
      data.unit,
      round(toNumber(data.stock), QTY_DECIMALS),
      round(toNumber(data.minimum_stock), QTY_DECIMALS),
      round(toNumber(data.unit_price)),
      data.is_active === false ? 0 : 1,
    ]
  );

  return findById(result.insertId);
}

/**
 * @param {number} id
 * @param {object} data
 */
async function update(id, data) {
  const existing = await findById(id);
  if (!existing) throw ApiError.notFound('Bahan baku tidak ditemukan.');

  if (data.unit !== undefined && !UNITS.includes(data.unit)) {
    throw ApiError.badRequest(`Satuan harus salah satu dari: ${UNITS.join(', ')}.`);
  }

  const updates = [];
  const params = [];

  if (data.code !== undefined) { updates.push('code = ?'); params.push(data.code); }
  if (data.name !== undefined) { updates.push('name = ?'); params.push(data.name); }
  if (data.unit !== undefined) { updates.push('unit = ?'); params.push(data.unit); }
  if (data.minimum_stock !== undefined) {
    if (round(toNumber(data.minimum_stock), QTY_DECIMALS) < 0) {
      throw ApiError.badRequest('Stok minimum tidak boleh negatif.');
    }
    updates.push('minimum_stock = ?');
    params.push(round(toNumber(data.minimum_stock), QTY_DECIMALS));
  }
  if (data.unit_price !== undefined) {
    updates.push('unit_price = ?');
    params.push(round(toNumber(data.unit_price)));
  }
  if (data.is_active !== undefined) { updates.push('is_active = ?'); params.push(data.is_active ? 1 : 0); }

  // Kolom `stock` sengaja TIDAK bisa diubah lewat sini. Gunakan penyesuaian
  // stok (inventory.service.adjustStock) supaya jurnal ikut tercatat.

  if (updates.length > 0) {
    params.push(id);
    await query(`UPDATE ingredients SET ${updates.join(', ')} WHERE id = ?`, params);
  }

  return findById(id);
}

/**
 * @param {number} id
 */
async function remove(id) {
  const existing = await findById(id);
  if (!existing) throw ApiError.notFound('Bahan baku tidak ditemukan.');

  // Bahan yang sudah dipakai di recipe tidak boleh dihapus, karena riwayat
  // produksi akan kehilangan makna. Nonaktifkan saja.
  const [recipeRows] = await query(
    `SELECT COUNT(*) AS total FROM recipe_items WHERE ingredient_id = ?`,
    [id]
  );
  if (recipeRows[0].total > 0) {
    throw ApiError.conflict(
      `Bahan "${existing.name}" dipakai pada ${recipeRows[0].total} recipe. Nonaktifkan, bukan hapus.`
    );
  }

  await query(`UPDATE ingredients SET is_active = 0 WHERE id = ?`, [id]);
  return { id: Number(id), is_active: false };
}

/**
 * Bahan yang stoknya sudah menyentuh batas minimum.
 * @returns {Promise<object[]>}
 */
async function lowStock() {
  const [rows] = await query(
    `SELECT id, code, name, unit, stock, minimum_stock
       FROM ingredients
      WHERE is_active = 1
        AND minimum_stock > 0
        AND stock <= minimum_stock
      ORDER BY (stock / NULLIF(minimum_stock, 0)) ASC`
  );
  return rows.map(decorate);
}

/**
 * Ubah kolom TINYINT dan DECIMAL dari database menjadi bentuk yang enak dipakai
 * JavaScript.
 */
function decorate(row) {
  const stock = round(toNumber(row.stock), QTY_DECIMALS);
  const minimumStock = round(toNumber(row.minimum_stock), QTY_DECIMALS);

  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    unit: row.unit,
    stock,
    minimumStock,
    unitPrice: round(toNumber(row.unit_price)),
    supplierId: row.supplier_id ? Number(row.supplier_id) : null,
    isActive: Boolean(row.is_active),
    isLowStock: minimumStock > 0 && stock <= minimumStock,
    // Nilai stok dalam satuan dasar, berguna saat agregasi antar bahan.
    stockInBaseUnit: toBaseUnit(stock, row.unit),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  UNITS,
  QTY_DECIMALS,
  toBaseUnit,
  list,
  findById,
  findByIds,
  findByIdForUpdate,
  create,
  update,
  remove,
  lowStock,
};