'use strict';

/**
 * Service Stock Opname (hitung fisik).
 *
 * Opname membandingkan stok sistem dengan hasil hitung fisik di gudang.
 * Selisihnya baru memengaruhi stok ketika opname disetujui, dan saat itu
 * dicatat sebagai mutasi bertipe OPNAME supaya ada jejaknya di jurnal.
 *
 * ALUR
 *   1. Buat opname berstatus DRAFT
 *   2. Staff mengisi physical_stock hasil hitung
 *   3. Approve  -> stok sistem disesuaikan, jurnal OPNAME tercatat
 *   4. Cancel  -> opname dibuang, stok tidak berubah
 *
 * Stok sistem dibekukan (system_stock) saat baris opname dibuat, bukan saat
 * approve, supaya selisih yang terlihat sama dengan yang dilihat petugas.
 */

const { query, withTransaction } = require('../config/database');
const ApiError = require('../utils/ApiError');
const { round } = require('../utils/money');
const ingredientService = require('./ingredient.service');
const inventoryService = require('./inventory.service');
const socket = require('../config/socket');

const QTY_DECIMALS = 3;

/**
 * Nomor opname harian, misal OPN-20261008-001.
 * Angka urut diambil dari jumlah opname pada tanggal yang sama, cukup untuk
 * satu restoran dengan concurrency rendah. Unik dijamin oleh kolom UNIQUE di database.
 */
async function buildOpnameNumber(conn) {
  const [rows] = await conn.execute(
    `SELECT COUNT(*) AS total
       FROM stock_opnames
      WHERE DATE(created_at) = CURDATE()`
  );

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');

  return `OPN-${yyyy}${mm}${dd}-${String(Number(rows[0].total) + 1).padStart(3, '0')}`;
}

/**
 * Buat opname baru, defaultnya memuat seluruh bahan aktif.
 *
 * @param {object} data
 * @param {string} [data.note]
 * @param {boolean} [data.includeAll]  isi otomatis dengan semua bahan aktif
 * @param {object|null} user
 */
async function create(data = {}, user = null) {
  const includeAll = data.includeAll !== false;

  // Hanya id yang dikembalikan dari dalam transaksi. Pembacaan ulang harus
  // dilakukan SETELAH commit: sebelum commit, perubahan belum terlihat oleh
  // koneksi lain, sehingga findById() akan mengembalikan null.
  const opnameId = await withTransaction(async (conn) => {
    const number = await buildOpnameNumber(conn);

    const [result] = await conn.execute(
      `INSERT INTO stock_opnames (opname_number, status, note, created_by)
       VALUES (?, 'DRAFT', ?, ?)`,
      [number, data.note ? String(data.note).slice(0, 500) : null, user ? user.id : null]
    );

    const newId = result.insertId;

    if (includeAll) {
      const [ingredients] = await conn.execute(
        `SELECT id, stock FROM ingredients WHERE is_active = 1 ORDER BY name ASC`
      );

      for (const ingredient of ingredients) {
        await conn.execute(
          `INSERT INTO stock_opname_items (stock_opname_id, ingredient_id, system_stock, difference)
           VALUES (?, ?, ?, 0)`,
          [newId, ingredient.id, round(Number(ingredient.stock), QTY_DECIMALS)]
        );
      }
    }

    return newId;
  });

  return findById(opnameId);
}

/**
 * @param {number} id
 */
async function findById(id) {
  const [rows] = await query(
    `SELECT o.id, o.opname_number, o.status, o.note, o.created_at, o.approved_at,
            o.created_by, o.approved_by,
            uc.name AS created_by_name, ua.name AS approved_by_name
       FROM stock_opnames o
       LEFT JOIN users uc ON uc.id = o.created_by
       LEFT JOIN users ua ON ua.id = o.approved_by
      WHERE o.id = ?
      LIMIT 1`,
    [id]
  );
  if (rows.length === 0) return null;

  const [itemRows] = await query(
    `SELECT oi.id, oi.ingredient_id, oi.system_stock, oi.physical_stock, oi.difference, oi.note,
            i.code AS ingredient_code, i.name AS ingredient_name, i.unit,
            i.stock AS current_stock
       FROM stock_opname_items oi
       JOIN ingredients i ON i.id = oi.ingredient_id
      WHERE oi.stock_opname_id = ?
      ORDER BY i.name ASC`,
    [id]
  );

  const items = itemRows.map((row) => {
    const physical = row.physical_stock === null ? null : round(Number(row.physical_stock), QTY_DECIMALS);
    const systemStock = round(Number(row.system_stock), QTY_DECIMALS);

    return {
      id: Number(row.id),
      ingredientId: Number(row.ingredient_id),
      ingredientCode: row.ingredient_code,
      ingredientName: row.ingredient_name,
      unit: row.unit,
      systemStock,
      physicalStock: physical,
      currentStock: round(Number(row.current_stock), QTY_DECIMALS),
      // Selisih hanya dihitung bila hasil hitung sudah diisi.
      difference: physical === null ? 0 : round(physical - systemStock, QTY_DECIMALS),
      note: row.note,
    };
  });

  const filled = items.filter((item) => item.physicalStock !== null);
  const totalDifference = round(
    filled.reduce((sum, item) => sum + item.difference, 0),
    QTY_DECIMALS
  );

  return {
    id: Number(rows[0].id),
    opnameNumber: rows[0].opname_number,
    status: rows[0].status,
    note: rows[0].note,
    createdBy: rows[0].created_by ? Number(rows[0].created_by) : null,
    createdByName: rows[0].created_by_name,
    approvedBy: rows[0].approved_by ? Number(rows[0].approved_by) : null,
    approvedByName: rows[0].approved_by_name,
    createdAt: rows[0].created_at,
    approvedAt: rows[0].approved_at,
    items,
    totalItems: items.length,
    filledItems: filled.length,
    totalDifference,
  };
}

/**
 * Daftar opname.
 * @param {object} [filters]
 */
async function list(filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.status) {
    conditions.push('o.status = ?');
    params.push(filters.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await query(
    `SELECT o.id, o.opname_number, o.status, o.note, o.created_at, o.approved_at,
            uc.name AS created_by_name,
            (SELECT COUNT(*) FROM stock_opname_items oi WHERE oi.stock_opname_id = o.id) AS item_count,
            (SELECT COUNT(*) FROM stock_opname_items oi WHERE oi.stock_opname_id = o.id AND oi.physical_stock IS NOT NULL) AS filled_count
       FROM stock_opnames o
       LEFT JOIN users uc ON uc.id = o.created_by
       ${where}
      ORDER BY o.id DESC
      LIMIT ? OFFSET ?`,
    [...params, filters.limit ?? 20, filters.offset ?? 0]
  );

  const [countRows] = await query(
    `SELECT COUNT(*) AS total FROM stock_opnames o ${where}`,
    params
  );

  return {
    rows: rows.map((row) => ({
      id: Number(row.id),
      opnameNumber: row.opname_number,
      status: row.status,
      note: row.note,
      createdByName: row.created_by_name,
      itemCount: Number(row.item_count),
      filledItems: Number(row.filled_count),
      createdAt: row.created_at,
      approvedAt: row.approved_at,
    })),
    total: countRows[0].total,
  };
}

/**
 * Simpan hasil hitung fisik untuk satu bahan di dalam opname.
 *
 * @param {number} opnameId
 * @param {number} ingredientId
 * @param {number|null} physicalStock  null berarti belum dihitung
 * @param {string} [note]
 */
async function recordPhysicalStock(opnameId, ingredientId, physicalStock, note = null) {
  const opname = await findById(opnameId);
  if (!opname) throw ApiError.notFound('Stock opname tidak ditemukan.');
  if (opname.status !== 'DRAFT') {
    throw ApiError.conflict(
      `Opname berstatus ${opname.status} tidak bisa diubah lagi.`
    );
  }

  const item = opname.items.find((entry) => entry.ingredientId === Number(ingredientId));
  if (!item) {
    throw ApiError.badRequest('Bahan ini tidak termasuk dalam opname tersebut.');
  }

  const value =
    physicalStock === null || physicalStock === undefined || physicalStock === ''
      ? null
      : round(Number(physicalStock), QTY_DECIMALS);

  if (value !== null && value < 0) {
    throw ApiError.badRequest('Jumlah hasil hitung tidak boleh negatif.');
  }

  await query(
    `UPDATE stock_opname_items
        SET physical_stock = ?, difference = ?, note = ?
      WHERE stock_opname_id = ? AND ingredient_id = ?`,
    [value, value === null ? 0 : round(value - item.systemStock, QTY_DECIMALS), note, opnameId, ingredientId]
  );

  return findById(opnameId);
}

/**
 * Setujui opname: sesuaikan stok sistem dengan hasil hitung.
 *
 * Setiap bahan yang selisihnya tidak nol menghasilkan satu baris jurnal
 * bertipe OPNAME.
 *
 * @param {number} opnameId
 * @param {object|null} user
 */
async function approve(opnameId, user = null) {
  const opname = await findById(opnameId);
  if (!opname) throw ApiError.notFound('Stock opname tidak ditemukan.');

  if (opname.status === 'APPROVED') {
    throw ApiError.conflict('Opname ini sudah disetujui sebelumnya.');
  }
  if (opname.status === 'CANCELLED') {
    throw ApiError.conflict('Opname yang dibatalkan tidak bisa disetujui.');
  }

  const unfilled = opname.items.filter((item) => item.physicalStock === null);
  if (unfilled.length > 0) {
    throw ApiError.badRequest(
      `Masih ada ${unfilled.length} bahan yang belum diisi hasil hitungnya. ` +
        `Contoh: ${unfilled.slice(0, 3).map((item) => item.ingredientName).join(', ')}` +
        (unfilled.length > 3 ? '...' : '')
    );
  }

  const adjusted = [];

  await withTransaction(async (conn) => {
    // Kunci baris opname supaya tidak bisa disetujui dua kali bersamaan.
    const [opnameRows] = await conn.execute(
      `SELECT id, status FROM stock_opnames WHERE id = ? FOR UPDATE`,
      [opnameId]
    );
    if (opnameRows.length === 0) throw ApiError.notFound('Stock opname tidak ditemukan.');
    if (opnameRows[0].status !== 'DRAFT') {
      throw ApiError.conflict('Opname sudah diproses oleh pengguna lain.');
    }

    // Urutkan id bahan agar semua transaksi mengunci baris dengan urutan sama
    // dan tidak terjadi deadlock.
    const sortedItems = [...opname.items].sort((a, b) => a.ingredientId - b.ingredientId);

    for (const item of sortedItems) {
      const ingredient = await ingredientService.findByIdForUpdate(conn, item.ingredientId);
      if (!ingredient) continue;

      // Stok terkini bisa berbeda dari system_stock bila ada mutasi setelah
      // opname dibuat. Selisih yang adjustsDlg perbedaan terhadap stok SEKARANG.
      const currentStock = ingredient.stock;
      const targetStock = item.physicalStock;
      const delta = round(targetStock - currentStock, QTY_DECIMALS);

      if (delta === 0) {
        await conn.execute(
          `UPDATE stock_opname_items SET difference = 0 WHERE id = ?`,
          [item.id]
        );
        continue;
      }

      const stockAfter = round(targetStock, QTY_DECIMALS);

      await conn.execute(`UPDATE ingredients SET stock = ? WHERE id = ?`, [
        stockAfter,
        item.ingredientId,
      ]);

      await conn.execute(
        `INSERT INTO inventory_transactions
           (ingredient_id, type, quantity_in, quantity_out, stock_before, stock_after,
            reference_type, reference_id, note, created_by)
         VALUES (?, 'OPNAME', ?, ?, ?, ?, 'opname', ?, ?, ?)`,
        [
          item.ingredientId,
          delta > 0 ? delta : 0,
          delta < 0 ? Math.abs(delta) : 0,
          currentStock,
          stockAfter,
          opnameId,
          `Stock opname ${opname.opnameNumber}`,
          user ? user.id : null,
        ]
      );

      await conn.execute(
        `UPDATE stock_opname_items SET difference = ? WHERE id = ?`,
        [delta, item.id]
      );

      adjusted.push({
        ingredientId: item.ingredientId,
        ingredientName: ingredient.name,
        unit: ingredient.unit,
        delta,
        stockBefore: currentStock,
        stockAfter,
      });
    }

    await conn.execute(
      `UPDATE stock_opnames
          SET status = 'APPROVED', approved_by = ?, approved_at = NOW()
        WHERE id = ?`,
      [user ? user.id : null, opnameId]
    );
  });

  const updated = await findById(opnameId);

  socket.emitTo('inventory', 'opname:approved', {
    opnameId,
    opnameNumber: updated.opnameNumber,
    adjusted,
  });

  for (const movement of adjusted) {
    await inventoryService.afterStockChange({
      ingredientId: movement.ingredientId,
      stockAfter: movement.stockAfter,
    });
  }

  return { opname: updated, adjusted };
}

/**
 * @param {number} opnameId
 * @param {object|null} user
 */
async function cancel(opnameId, user = null) {
  const opname = await findById(opnameId);
  if (!opname) throw ApiError.notFound('Stock opname tidak ditemukan.');

  if (opname.status !== 'DRAFT') {
    throw ApiError.conflict(
      `Hanya opname berstatus DRAFT yang bisa dibatalkan. Opname ini berstatus ${opname.status}.`
    );
  }

  await query(
    `UPDATE stock_opnames SET status = 'CANCELLED', approved_by = ?, approved_at = NOW() WHERE id = ?`,
    [user ? user.id : null, opnameId]
  );

  return findById(opnameId);
}

module.exports = {
  QTY_DECIMALS,
  create,
  findById,
  list,
  recordPhysicalStock,
  approve,
  cancel,
};