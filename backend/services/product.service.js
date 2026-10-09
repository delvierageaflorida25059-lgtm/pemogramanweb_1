'use strict';

const { query, withTransaction } = require('../config/database');
const ApiError = require('../utils/ApiError');
const { round } = require('../utils/money');

/**
 * Service produk beserta varian dan addon.
 *
 * Modul ini menjadi sumber harga yang otoritatif. Harga yang dipakai saat
 * membuat order SELALU diambil ulang dari database, bukan dari nilai yang
 * dikirim frontend, supaya manipulasi harga dari sisi klien tidak berhasil.
 */

/** Kolom yang boleh dipakai sebagai filter, dipetakan ke kolom SQL. */
const SORTABLE_COLUMNS = {
  name: 'p.name',
  price: 'p.price',
  newest: 'p.id',
};

/**
 * @param {object} [filters]
 * @param {number} [filters.categoryId]
 * @param {string} [filters.search]
 * @param {boolean} [filters.activeOnly]
 * @param {boolean} [filters.availableOnly]  hanya produk yang AVAILABLE
 * @param {number} [filters.limit]
 * @param {number} [filters.offset]
 * @returns {Promise<{rows:object[], total:number}>}
 */
async function list(filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.categoryId) {
    conditions.push('p.category_id = ?');
    params.push(filters.categoryId);
  }
  if (filters.search) {
    conditions.push('(p.name LIKE ? OR p.code LIKE ?)');
    const keyword = `%${filters.search}%`;
    params.push(keyword, keyword);
  }
  if (filters.activeOnly) conditions.push('p.is_active = 1');
  if (filters.availableOnly) conditions.push(`p.stock_status = 'AVAILABLE'`);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRows] = await query(
    `SELECT COUNT(*) AS total FROM products p ${where}`,
    params
  );

  const [rows] = await query(
    `SELECT p.id, p.category_id, p.code, p.name, p.description, p.price,
            p.image_url, p.stock_status, p.is_active, p.sort_order,
            p.created_at, p.updated_at,
            c.name AS category_name
       FROM products p
       JOIN categories c ON c.id = p.category_id
       ${where}
      ORDER BY c.sort_order ASC, p.sort_order ASC, p.name ASC
      LIMIT ? OFFSET ?`,
    [...params, filters.limit ?? 50, filters.offset ?? 0]
  );

  const products = await attachChildren(rows);

  return { rows: products, total: countRows[0].total };
}

/**
 * @param {number} id
 * @param {object} [options]
 * @param {boolean} [options.withChildren=true]
 */
async function findById(id, options = {}) {
  const [rows] = await query(
    `SELECT p.id, p.category_id, p.code, p.name, p.description, p.price,
            p.image_url, p.stock_status, p.is_active, p.sort_order,
            p.created_at, p.updated_at,
            c.name AS category_name
       FROM products p
       JOIN categories c ON c.id = p.category_id
      WHERE p.id = ?
      LIMIT 1`,
    [id]
  );
  if (rows.length === 0) return null;

  const [product] = await attachChildren(rows);
  if (options.withChildren === false) {
    return { ...product, variants: undefined, addons: undefined };
  }
  return product;
}

/**
 * Ambil beberapa produk sekaligus berdasarkan daftar id.
 * Dipakai order service untuk meresolve harga dalam satu round-trip.
 *
 * @param {number[]} ids
 * @returns {Promise<Map<number, object>>}
 */
async function findByIds(ids) {
  if (ids.length === 0) return new Map();

  const [rows] = await query(
    `SELECT p.id, p.code, p.name, p.price, p.stock_status, p.is_active, p.category_id
       FROM products p
      WHERE p.id IN (${ids.map(() => '?').join(',')})`,
    ids
  );
  return new Map(rows.map((row) => [Number(row.id), row]));
}

// ---------------------------------------------------------------------------
// Varian
// ---------------------------------------------------------------------------

/**
 * @param {number} productId
 * @param {object} data
 */
async function addVariant(productId, data) {
  const product = await findById(productId, { withChildren: false });
  if (!product) throw ApiError.notFound('Produk tidak ditemukan.');

  const [result] = await query(
    `INSERT INTO product_variants (product_id, name, price, is_default, is_active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      productId,
      data.name,
      data.price ?? null,
      data.is_default ? 1 : 0,
      data.is_active === false ? 0 : 1,
      data.sort_order ?? 0,
    ]
  );
  return findById(productId);
}

/**
 * @param {number} productId
 * @param {number} variantId
 * @param {object} data
 */
async function updateVariant(productId, variantId, data) {
  const [variantRows] = await query(
    `SELECT id FROM product_variants WHERE id = ? AND product_id = ? LIMIT 1`,
    [variantId, productId]
  );
  if (variantRows.length === 0) {
    throw ApiError.notFound('Varian tidak ditemukan pada produk ini.');
  }

  const updates = [];
  const params = [];
  if (data.name !== undefined) { updates.push('name = ?'); params.push(data.name); }
  if (data.price !== undefined) { updates.push('price = ?'); params.push(data.price); }
  if (data.is_default !== undefined) { updates.push('is_default = ?'); params.push(data.is_default ? 1 : 0); }
  if (data.is_active !== undefined) { updates.push('is_active = ?'); params.push(data.is_active ? 1 : 0); }
  if (data.sort_order !== undefined) { updates.push('sort_order = ?'); params.push(data.sort_order); }

  if (updates.length > 0) {
    params.push(variantId);
    await query(`UPDATE product_variants SET ${updates.join(', ')} WHERE id = ?`, params);
  }
  return findById(productId);
}

/** @param {number} productId @param {number} variantId */
async function removeVariant(productId, variantId) {
  const [result] = await query(
    `DELETE FROM product_variants WHERE id = ? AND product_id = ?`,
    [variantId, productId]
  );
  if (result.affectedRows === 0) {
    throw ApiError.notFound('Varian tidak ditemukan pada produk ini.');
  }
}

// ---------------------------------------------------------------------------
// Addon
// ---------------------------------------------------------------------------

/**
 * @param {number} productId
 * @param {object} data
 */
async function addAddon(productId, data) {
  const product = await findById(productId, { withChildren: false });
  if (!product) throw ApiError.notFound('Produk tidak ditemukan.');

  await query(
    `INSERT INTO product_addons (product_id, category_id, name, price, is_active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      productId,
      data.apply_to_category ? product.category_id : null,
      data.name,
      data.price ?? 0,
      data.is_active === false ? 0 : 1,
      data.sort_order ?? 0,
    ]
  );
  return findById(productId);
}

/** @param {number} productId @param {number} addonId @param {object} data */
async function updateAddon(productId, addonId, data) {
  const [addonRows] = await query(
    `SELECT id FROM product_addons WHERE id = ? AND product_id = ? LIMIT 1`,
    [addonId, productId]
  );
  if (addonRows.length === 0) {
    throw ApiError.notFound('Addon tidak ditemukan pada produk ini.');
  }

  const updates = [];
  const params = [];
  if (data.name !== undefined) { updates.push('name = ?'); params.push(data.name); }
  if (data.price !== undefined) { updates.push('price = ?'); params.push(round(data.price)); }
  if (data.is_active !== undefined) { updates.push('is_active = ?'); params.push(data.is_active ? 1 : 0); }

  if (updates.length > 0) {
    params.push(addonId);
    await query(`UPDATE product_addons SET ${updates.join(', ')} WHERE id = ?`, params);
  }
  return findById(productId);
}

/** @param {number} productId @param {number} addonId */
async function removeAddon(productId, addonId) {
  const [result] = await query(
    `DELETE FROM product_addons WHERE id = ? AND product_id = ?`,
    [addonId, productId]
  );
  if (result.affectedRows === 0) {
    throw ApiError.notFound('Addon tidak ditemukan pada produk ini.');
  }
}

// ---------------------------------------------------------------------------
// Produk
// ---------------------------------------------------------------------------

/** @param {object} data */
async function create(data) {
  const [categoryRows] = await query(`SELECT id FROM categories WHERE id = ? LIMIT 1`, [
    data.category_id,
  ]);
  if (categoryRows.length === 0) {
    throw ApiError.badRequest('Kategori yang dipilih tidak ditemukan.');
  }

  const [result] = await query(
    `INSERT INTO products (category_id, code, name, description, price, image_url,
                           stock_status, is_active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.category_id,
      data.code,
      data.name,
      data.description ?? null,
      round(data.price),
      data.image_url ?? null,
      data.stock_status || 'AVAILABLE',
      data.is_active === false ? 0 : 1,
      data.sort_order ?? 0,
    ]
  );

  const productId = result.insertId;

  if (Array.isArray(data.variants)) {
    for (let index = 0; index < data.variants.length; index += 1) {
      const variant = data.variants[index];
      await query(
        `INSERT INTO product_variants (product_id, name, price, is_default, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [
          productId,
          variant.name,
          variant.price ?? null,
          index === 0 ? 1 : 0,
          (index + 1) * 10,
        ]
      );
    }
  }

  return findById(productId);
}

/**
 * @param {number} id
 * @param {object} data
 */
async function update(id, data) {
  const existing = await findById(id, { withChildren: false });
  if (!existing) throw ApiError.notFound('Produk tidak ditemukan.');

  if (data.category_id !== undefined) {
    const [categoryRows] = await query(`SELECT id FROM categories WHERE id = ? LIMIT 1`, [
      data.category_id,
    ]);
    if (categoryRows.length === 0) {
      throw ApiError.badRequest('Kategori yang dipilih tidak ditemukan.');
    }
  }

  const updates = [];
  const params = [];

  const simpleFields = [
    ['category_id', (v) => v],
    ['code', (v) => v],
    ['name', (v) => v],
    ['description', (v) => v || null],
    ['price', (v) => round(v)],
    ['image_url', (v) => v || null],
    ['sort_order', (v) => v],
    ['is_active', (v) => (v ? 1 : 0)],
    ['stock_status', (v) => v],
  ];

  for (const [column, transform] of simpleFields) {
    if (data[column] !== undefined) {
      updates.push(`${column} = ?`);
      params.push(transform(data[column]));
    }
  }

  if (updates.length > 0) {
    params.push(id);
    await query(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`, params);
  }

  return findById(id);
}

/**
 * Nonaktifkan produk.
 *
 * Produk TIDAK dihapus fisik karena sudah pernah dipakai di order_items dan
 * schema memakai ON DELETE RESTRICT. Menonaktifkan menjaga integritas riwayat
 * transaksi sekaligus hilang dari daftar menu.
 *
 * @param {number} id
 */
async function remove(id) {
  const existing = await findById(id, { withChildren: false });
  if (!existing) throw ApiError.notFound('Produk tidak ditemukan.');

  await query(`UPDATE products SET is_active = 0, stock_status = 'UNAVAILABLE' WHERE id = ?`, [id]);
  return { id: Number(id), is_active: false, stock_status: 'UNAVAILABLE' };
}

/**
 * Ubah status ketersediaan produk (tombol "habis" di halaman kasir).
 * @param {number} id
 * @param {string} stockStatus AVAILABLE | UNAVAILABLE
 */
async function setStockStatus(id, stockStatus) {
  const [result] = await query(
    `UPDATE products SET stock_status = ? WHERE id = ?`,
    [stockStatus, id]
  );
  if (result.affectedRows === 0) throw ApiError.notFound('Produk tidak ditemukan.');
  return findById(id, { withChildren: false });
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Lampirkan varian dan addon ke daftar produk dalam jumlah query tetap.
 * @param {object[]} products
 */
async function attachChildren(products) {
  if (products.length === 0) return products;

  const ids = products.map((product) => product.id);
  const placeholders = ids.map(() => '?').join(',');

  const [variantRows] = await query(
    `SELECT id, product_id, name, price, is_default, is_active, sort_order
       FROM product_variants
      WHERE product_id IN (${placeholders}) AND is_active = 1
      ORDER BY sort_order ASC, id ASC`,
    ids
  );

  const [addonRows] = await query(
    `SELECT id, product_id, name, price, sort_order
       FROM product_addons
      WHERE product_id IN (${placeholders}) AND is_active = 1
      ORDER BY sort_order ASC, id ASC`,
    ids
  );

  // Addon yang menempel ke kategori ikut berlaku untuk semua produk di
  // kategori tersebut, jadi perlu diambil berdasarkan category_id.
  const categoryIds = [...new Set(products.map((product) => product.category_id))];
  const [categoryAddonRows] = await query(
    `SELECT id, category_id, name, price, sort_order
       FROM product_addons
      WHERE category_id IN (${categoryIds.map(() => '?').join(',')}) AND is_active = 1
      ORDER BY sort_order ASC, id ASC`,
    categoryIds
  );

  const variantsByProduct = new Map();
  for (const row of variantRows) {
    if (!variantsByProduct.has(row.product_id)) variantsByProduct.set(row.product_id, []);
    variantsByProduct.get(row.product_id).push({
      ...row,
      price: row.price === null ? null : round(row.price),
      is_default: Boolean(row.is_default),
      is_active: Boolean(row.is_active),
    });
  }

  const addonsByProduct = new Map();
  const addonsByCategory = new Map();

  const pushTo = (map, key, item) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  };

  for (const row of addonRows) pushTo(addonsByProduct, row.product_id, normalizeAddon(row));
  for (const row of categoryAddonRows) pushTo(addonsByCategory, row.category_id, normalizeAddon(row));

  return products.map((product) => {
    const own = addonsByProduct.get(product.id) || [];
    const fromCategory = addonsByCategory.get(product.category_id) || [];
    return {
      ...product,
      price: round(product.price),
      is_active: Boolean(product.is_active),
      variants: variantsByProduct.get(product.id) || [],
      addons: [...own, ...fromCategory],
    };
  });
}

function normalizeAddon(row) {
  return { id: Number(row.id), name: row.name, price: round(row.price) };
}

module.exports = {
  list,
  findById,
  findByIds,
  create,
  update,
  remove,
  setStockStatus,
  addVariant,
  updateVariant,
  removeVariant,
  addAddon,
  updateAddon,
  removeAddon,
  SORTABLE_COLUMNS,
};