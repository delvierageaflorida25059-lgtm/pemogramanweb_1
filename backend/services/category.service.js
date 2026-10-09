'use strict';

const { query } = require('../config/database');
const ApiError = require('../utils/ApiError');

/**
 * Service kategori menu.
 * Kategori adalah level teratas dari hierarki menu dan selalu punya produk
 * minimal satu sebelum bisa dihapus.
 */

/**
 * @param {object} [filters]
 * @param {boolean} [filters.activeOnly]
 * @returns {Promise<object[]>}
 */
async function list(filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.activeOnly) {
    conditions.push('c.is_active = 1');
  }
  if (filters.search) {
    conditions.push('c.name LIKE ?');
    params.push(`%${filters.search}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await query(
    `SELECT c.id, c.name, c.description, c.sort_order, c.is_active,
            c.created_at, c.updated_at,
            (SELECT COUNT(*) FROM products p
              WHERE p.category_id = c.id AND p.is_active = 1) AS product_count
       FROM categories c
       ${where}
      ORDER BY c.sort_order ASC, c.name ASC`,
    params
  );

  return rows.map(normalize);
}

/** @param {number} id */
async function findById(id) {
  const [rows] = await query(
    `SELECT id, name, description, sort_order, is_active, created_at, updated_at
       FROM categories
      WHERE id = ?
      LIMIT 1`,
    [id]
  );
  return rows.length ? normalize(rows[0]) : null;
}

/** @param {object} data */
async function create(data) {
  const [result] = await query(
    `INSERT INTO categories (name, description, sort_order, is_active)
     VALUES (?, ?, ?, ?)`,
    [data.name, data.description ?? null, data.sort_order ?? 0, data.is_active === false ? 0 : 1]
  );
  return findById(result.insertId);
}

/**
 * @param {number} id
 * @param {object} data
 */
async function update(id, data) {
  const existing = await findById(id);
  if (!existing) throw ApiError.notFound('Kategori tidak ditemukan.');

  const updates = [];
  const params = [];

  if (data.name !== undefined) { updates.push('name = ?'); params.push(data.name); }
  if (data.description !== undefined) { updates.push('description = ?'); params.push(data.description || null); }
  if (data.sort_order !== undefined) { updates.push('sort_order = ?'); params.push(data.sort_order); }
  if (data.is_active !== undefined) { updates.push('is_active = ?'); params.push(data.is_active ? 1 : 0); }

  if (updates.length > 0) {
    params.push(id);
    await query(`UPDATE categories SET ${updates.join(', ')} WHERE id = ?`, params);
  }

  return findById(id);
}

/**
 * Hapus kategori.
 * Kategori yang masih punya produk ditolak agar tidak ada produk yatim.
 *
 * @param {number} id
 */
async function remove(id) {
  const [productRows] = await query(
    `SELECT COUNT(*) AS total FROM products WHERE category_id = ?`,
    [id]
  );
  if (productRows[0].total > 0) {
    throw ApiError.conflict(
      `Kategori masih memiliki ${productRows[0].total} produk. Pindahkan atau hapus produknya dulu.`
    );
  }

  const [result] = await query(`DELETE FROM categories WHERE id = ?`, [id]);
  if (result.affectedRows === 0) throw ApiError.notFound('Kategori tidak ditemukan.');

  return { id: Number(id) };
}

/** Ubah kolom TINYINT(1) dari database menjadi boolean. */
function normalize(row) {
  return { ...row, is_active: Boolean(row.is_active) };
}

module.exports = { list, findById, create, update, remove };