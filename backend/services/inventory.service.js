'use strict';

/**
 * Service Inventory - movements, stock deduction, and stock recovery.
 *
 * This module is the ONLY place that can change ingredients.stock. Each change
 * always writes a journal row to inventory_transactions so the current number
 * and its history can always be reconciled.
 *
 * DEDUCTION TIMING
 * Stock is deducted when an order moves to CONFIRMED, not when the order is
 * created. Reasons:
 *   1. An order that is created but cancelled before payment should not have
 *      consumed stock.
 *   2. Deduction is tied to the same DB transaction as the status change, so
 *      order status and stock can never disagree.
 *
 * RECOVERY
 * When an order is CANCELLED, stock is returned with a journal entry of
 * type VOID and reference_type = 'order', so the same order can never be
 * restored twice (the deduction entry is queried first).
 */

const { query, withTransaction } = require('../config/database');
const ApiError = require('../utils/ApiError');
const config = require('../config/env');
const { round } = require('../utils/money');
const ingredientService = require('./ingredient.service');
const recipeService = require('./recipe.service');
const notificationService = require('./notification.service');
const socket = require('../config/socket');

const QTY_DECIMALS = 3;

const TX_TYPES = ['PURCHASE', 'SALE', 'ADJUSTMENT', 'OPNAME', 'WASTE', 'VOID', 'RETURN'];

/** Label Bahasa Indonesia untuk setiap jenis mutasi (dipakai di tampilan jurnal). */
const TYPE_LABELS = {
  PURCHASE: 'Pembelian',
  SALE: 'Pemakaian / Penjualan',
  ADJUSTMENT: 'Penyesuaian',
  OPNAME: 'Stock Opname',
  WASTE: 'Rusak / Terbuang',
  VOID: 'Pengembalian (Void)',
  RETURN: 'Retur',
};

// ---------------------------------------------------------------------------
// Journal queries
// ---------------------------------------------------------------------------

/**
 * Mutation journal with filters.
 *
 * @param {object} [filters]
 * @param {number} [filters.ingredientId]
 * @param {string} [filters.type]
 * @param {number} [filters.orderId]
 * @param {string} [filters.from]   'YYYY-MM-DD'
 * @param {string} [filters.to]
 * @param {number} [filters.limit]
 * @param {number} [filters.offset]
 * @returns {Promise<{rows:object[], total:number}>}
 */
async function listMovements(filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.ingredientId) {
    conditions.push('t.ingredient_id = ?');
    params.push(Number(filters.ingredientId));
  }
  if (filters.type) {
    conditions.push('t.type = ?');
    params.push(filters.type);
  }
  if (filters.orderId) {
    conditions.push('t.order_id = ?');
    params.push(Number(filters.orderId));
  }
  if (filters.from) {
    conditions.push('t.created_at >= ?');
    params.push(`${filters.from} 00:00:00`);
  }
  if (filters.to) {
    conditions.push('t.created_at <= ?');
    params.push(`${filters.to} 23:59:59`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRows] = await query(
    `SELECT COUNT(*) AS total FROM inventory_transactions t ${where}`,
    params
  );

  const [rows] = await query(
    `SELECT t.id, t.ingredient_id, t.type, t.quantity_in, t.quantity_out,
            t.stock_before, t.stock_after, t.reference_type, t.reference_id,
            t.order_id, t.note, t.created_at, t.created_by,
            i.code AS ingredient_code, i.name AS ingredient_name, i.unit,
            o.order_number,
            u.name AS created_by_name
       FROM inventory_transactions t
       JOIN ingredients i ON i.id = t.ingredient_id
       LEFT JOIN orders o ON o.id = t.order_id
       LEFT JOIN users u   ON u.id = t.created_by
       ${where}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT ? OFFSET ?`,
    [...params, filters.limit ?? 50, filters.offset ?? 0]
  );

  return {
    rows: rows.map((row) => ({
      id: Number(row.id),
      ingredientId: Number(row.ingredient_id),
      ingredientCode: row.ingredient_code,
      ingredientName: row.ingredient_name,
      unit: row.unit,
      type: row.type,
      typeLabel: TYPE_LABELS[row.type] || row.type,
      quantityIn: round(Number(row.quantity_in), QTY_DECIMALS),
      quantityOut: round(Number(row.quantity_out), QTY_DECIMALS),
      stockBefore: round(Number(row.stock_before), QTY_DECIMALS),
      stockAfter: round(Number(row.stock_after), QTY_DECIMALS),
      referenceType: row.reference_type,
      referenceId: row.reference_id ? Number(row.reference_id) : null,
      orderId: row.order_id ? Number(row.order_id) : null,
      orderNumber: row.order_number,
      note: row.note,
      createdBy: row.created_by ? Number(row.created_by) : null,
      createdByName: row.created_by_name,
      createdAt: row.created_at,
    })),
    total: countRows[0].total,
  };
}

/**
 * Whether stock has ever been deducted for an order.
 * Used to guarantee the same order is never deducted (or restored) twice.
 *
 * @param {number} orderId
 * @returns {Promise<boolean>}
 */
async function hasDeductionForOrder(orderId) {
  const [rows] = await query(
    `SELECT COUNT(*) AS total
       FROM inventory_transactions
      WHERE order_id = ?
        AND type IN ('SALE', 'VOID')
        AND reference_type = 'order'`,
    [orderId]
  );
  return rows[0].total > 0;
}

// ---------------------------------------------------------------------------
// Stock deduction (called from order.service)
// ---------------------------------------------------------------------------

/**
 * Deduct ingredients for an order. MUST be called inside a transaction.
 *
 * @param {import('mysql2/promise').PoolConnection} conn
 * @param {number} orderId
 * @param {object|null} user
 * @returns {Promise<{deducted:object[], skipped:boolean, reason?:string}>}
 */
async function deductForOrder(conn, orderId, user = null) {
  // Idempotent: if this order was ever deducted, do nothing.
  const [existing] = await conn.execute(
    `SELECT COUNT(*) AS total
       FROM inventory_transactions
      WHERE order_id = ? AND type = 'SALE' AND reference_type = 'order'`,
    [orderId]
  );
  if (existing[0].total > 0) {
    return { deducted: [], skipped: true, reason: 'already-deducted' };
  }

  const [itemRows] = await conn.execute(
    `SELECT product_id, quantity
       FROM order_items
      WHERE order_id = ?`,
    [orderId]
  );

  if (itemRows.length === 0) {
    return { deducted: [], skipped: true, reason: 'no-items' };
  }

  const needs = await recipeService.requiredForMany(
    itemRows.map((row) => ({
      productId: Number(row.product_id),
      quantity: Number(row.quantity),
    }))
  );

  // Products without a recipe: normal, because not all products have a BOM yet.
  if (needs.size === 0) {
    return { deducted: [], skipped: true, reason: 'no-recipe' };
  }

  // Lock and validate all involved ingredients at once to avoid deadlock.
  const sortedIds = [...needs.keys()].sort((a, b) => a - b);

  const shortages = [];
  const deducted = [];

  for (const ingredientId of sortedIds) {
    const need = needs.get(ingredientId);
    const ingredient = await ingredientService.findByIdForUpdate(conn, ingredientId);
    if (!ingredient) continue;

    const requiredInBase = round(need.quantityInBaseUnit, QTY_DECIMALS);
    if (!(requiredInBase > 0)) continue;

    // Stock comparison uses base units (kg->gram, etc.).
    const stockInBase = ingredientService.toBaseUnit(ingredient.stock, ingredient.unit);

    if (stockInBase < requiredInBase) {
      shortages.push({
        ingredientId,
        name: ingredient.name,
        unit: ingredient.unit,
        available: ingredient.stock,
        required: round(requiredInBase, QTY_DECIMALS),
      });
    }
  }

  // Default policy: allow deductions to go negative and notify, because an
  // order the customer has already paid for must not be held up.
  if (shortages.length > 0 && !config.inventory.allowNegativeStock) {
    const detail = shortages
      .map((item) => `${item.name} (butuh ${item.required} ${item.unit}, ada ${item.available})`)
      .join('; ');
    throw ApiError.conflict(`Stok bahan baku tidak mencukupi: ${detail}`);
  }

  for (const ingredientId of sortedIds) {
    const need = needs.get(ingredientId);
    const ingredient = await ingredientService.findByIdForUpdate(conn, ingredientId);
    if (!ingredient) continue;

    const requiredInBase = round(need.quantityInBaseUnit, QTY_DECIMALS);
    if (!(requiredInBase > 0)) continue;

    const stockBefore = round(ingredient.stock, QTY_DECIMALS);
    const stockAfter = round(stockBefore - need.quantity, QTY_DECIMALS);

    // Subtract in the ingredient's actual unit (not base unit), to keep the
    // displayed number consistent with the unit chosen for that ingredient.
    await conn.execute(
      `UPDATE ingredients SET stock = ? WHERE id = ?`,
      [stockAfter, ingredientId]
    );

    await conn.execute(
      `INSERT INTO inventory_transactions
         (ingredient_id, type, quantity_in, quantity_out, stock_before, stock_after,
          reference_type, reference_id, order_id, note, created_by)
       VALUES (?, 'SALE', 0, ?, ?, ?, 'order', ?, ?, ?, ?)`,
      [
        ingredientId,
        need.quantity,
        stockBefore,
        stockAfter,
        orderId,
        orderId,
        `Order #${orderId}`,
        user ? user.id : null,
      ]
    );

    deducted.push({
      ingredientId,
      ingredientName: ingredient.name,
      unit: ingredient.unit,
      quantity: need.quantity,
      stockBefore,
      stockAfter,
    });
  }

  return { deducted, skipped: false, shortages };
}

/**
 * Return ingredient stock for a cancelled order. MUST be called inside a transaction.
 *
 * @param {import('mysql2/promise').PoolConnection} conn
 * @param {number} orderId
 * @param {object|null} user
 * @returns {Promise<{restored:object[], skipped:boolean}>}
 */
async function restoreForOrder(conn, orderId, user = null) {
  // Read deduction entries for this order and reverse them one by one.
  const [saleRows] = await conn.execute(
    `SELECT ingredient_id, quantity_out
       FROM inventory_transactions
      WHERE order_id = ?
        AND type = 'SALE'
        AND reference_type = 'order'`,
    [orderId]
  );

  if (saleRows.length === 0) {
    return { restored: [], skipped: true };
  }

  const restored = [];

  const sortedIds = [...new Set(saleRows.map((row) => Number(row.ingredient_id)))].sort(
    (a, b) => a - b
  );

  for (const ingredientId of sortedIds) {
    const ingredient = await ingredientService.findByIdForUpdate(conn, ingredientId);
    if (!ingredient) continue;

    // Sum of deductions for this ingredient in this order.
    let totalOut = 0;
    for (const row of saleRows) {
      if (Number(row.ingredient_id) === ingredientId) {
        totalOut += Number(row.quantity_out);
      }
    }
    totalOut = round(totalOut, QTY_DECIMALS);
    if (!(totalOut > 0)) continue;

    // Stop if already restored (idempotent against double cancellation).
    const [voidRows] = await conn.execute(
      `SELECT COALESCE(SUM(quantity_in), 0) AS total
         FROM inventory_transactions
        WHERE order_id = ? AND ingredient_id = ? AND type = 'VOID'`,
      [orderId, ingredientId]
    );
    if (Number(voidRows[0].total) > 0) continue;

    const stockBefore = round(ingredient.stock, QTY_DECIMALS);
    const stockAfter = round(stockBefore + totalOut, QTY_DECIMALS);

    await conn.execute(`UPDATE ingredients SET stock = ? WHERE id = ?`, [stockAfter, ingredientId]);

    await conn.execute(
      `INSERT INTO inventory_transactions
         (ingredient_id, type, quantity_in, quantity_out, stock_before, stock_after,
          reference_type, reference_id, order_id, note, created_by)
       VALUES (?, 'VOID', ?, 0, ?, ?, 'order', ?, ?, ?, ?)`,
      [
        ingredientId,
        totalOut,
        stockBefore,
        stockAfter,
        orderId,
        orderId,
        `Pengembalian order #${orderId}`,
        user ? user.id : null,
      ]
    );

    restored.push({
      ingredientId,
      ingredientName: ingredient.name,
      unit: ingredient.unit,
      quantity: totalOut,
      stockBefore,
      stockAfter,
    });
  }

  return { restored, skipped: false };
}

// ---------------------------------------------------------------------------
// Manual mutations (staff)
// ---------------------------------------------------------------------------

/**
 * Manual stock adjustment (correction, damage, expiry).
 *
 * @param {object} data
 * @param {number} data.ingredient_id
 * @param {string} data.direction  'IN' | 'OUT'
 * @param {number} data.quantity
 * @param {string} [data.note]
 * @param {object|null} user
 * @returns {Promise<object>}
 */
async function adjustStock(data, user = null) {
  const ingredientId = Number(data.ingredient_id);
  const quantity = round(Number(data.quantity), QTY_DECIMALS);

  if (!(quantity > 0)) {
    throw ApiError.badRequest('Jumlah penyesuaian harus lebih besar dari nol.');
  }
  if (!['IN', 'OUT'].includes(data.direction)) {
    throw ApiError.badRequest("Arah penyesuaian harus 'IN' atau 'OUT'.");
  }

  const result = await withTransaction(async (conn) => {
    const ingredient = await ingredientService.findByIdForUpdate(conn, ingredientId);
    if (!ingredient) throw ApiError.notFound('Bahan baku tidak ditemukan.');

    const stockBefore = ingredient.stock;
    const stockAfter =
      data.direction === 'IN'
        ? round(stockBefore + quantity, QTY_DECIMALS)
        : round(stockBefore - quantity, QTY_DECIMALS);

    if (stockAfter < 0 && !config.inventory.allowNegativeStock) {
      throw ApiError.conflict(
        `Stok "${ingredient.name}" tidak cukup. Tersedia ${stockBefore} ${ingredient.unit}.`
      );
    }

    await conn.execute(`UPDATE ingredients SET stock = ? WHERE id = ?`, [stockAfter, ingredientId]);

    await conn.execute(
      `INSERT INTO inventory_transactions
         (ingredient_id, type, quantity_in, quantity_out, stock_before, stock_after,
          reference_type, reference_id, note, created_by)
       VALUES (?, 'ADJUSTMENT', ?, ?, ?, ?, 'manual', NULL, ?, ?)`,
      [
        ingredientId,
        data.direction === 'IN' ? quantity : 0,
        data.direction === 'OUT' ? quantity : 0,
        stockBefore,
        stockAfter,
        data.note ? String(data.note).slice(0, 255) : null,
        user ? user.id : null,
      ]
    );

    return { ingredientId, name: ingredient.name, unit: ingredient.unit, stockBefore, stockAfter, quantity, direction: data.direction };
  });

  await afterStockChange(result);
  return result;
}

/**
 * Record stock received from a purchase (supplier).
 * Distinct from adjustStock with direction IN because the journal type is
 * different and will later connect to purchase orders.
 *
 * @param {object} data
 * @param {number} data.ingredient_id
 * @param {number} data.quantity
 * @param {number} [data.unit_price]
 * @param {string} [data.note]
 * @param {object|null} user
 */
async function recordPurchase(data, user = null) {
  const ingredientId = Number(data.ingredient_id);
  const quantity = round(Number(data.quantity), QTY_DECIMALS);

  if (!(quantity > 0)) {
    throw ApiError.badRequest('Jumlah barang masuk harus lebih besar dari nol.');
  }

  const result = await withTransaction(async (conn) => {
    const ingredient = await ingredientService.findByIdForUpdate(conn, ingredientId);
    if (!ingredient) throw ApiError.notFound('Bahan baku tidak ditemukan.');

    const stockBefore = ingredient.stock;
    const stockAfter = round(stockBefore + quantity, QTY_DECIMALS);

    await conn.execute(`UPDATE ingredients SET stock = ? WHERE id = ?`, [stockAfter, ingredientId]);

    await conn.execute(
      `INSERT INTO inventory_transactions
         (ingredient_id, type, quantity_in, quantity_out, stock_before, stock_after,
          reference_type, reference_id, note, created_by)
       VALUES (?, 'PURCHASE', ?, 0, ?, ?, 'manual', NULL, ?, ?)`,
      [
        ingredientId,
        quantity,
        stockBefore,
        stockAfter,
        data.note ? String(data.note).slice(0, 255) : null,
        user ? user.id : null,
      ]
    );

    return { ingredientId, name: ingredient.name, unit: ingredient.unit, stockBefore, stockAfter, quantity };
  });

  await afterStockChange(result);
  return result;
}

// ---------------------------------------------------------------------------
// Post-change hooks (notifications + realtime)
// ---------------------------------------------------------------------------

/**
 * After any stock change, check whether it has fallen below the minimum and
 * send a notification if so. Best-effort: failures are logged but don't
 * interrupt the business flow.
 */
async function afterStockChange(changed) {
  try {
    const ingredient = await ingredientService.findById(changed.ingredientId);
    if (!ingredient) return;

    if (ingredient.minimumStock > 0 && ingredient.stock <= ingredient.minimumStock) {
      const threshold = config.inventory.lowStockThresholdPercent / 100;
      const thresholdValue = round(ingredient.minimumStock * threshold, QTY_DECIMALS);

      if (ingredient.stock <= thresholdValue) {
        await notificationService.create({
          type: 'STOCK',
          title: `Stok menipis: ${ingredient.name}`,
          message: `Stok ${ingredient.name} tersisa ${ingredient.stock} ${ingredient.unit} (minimum ${ingredient.minimumStock} ${ingredient.unit}).`,
          userId: null,
        });

        socket.emitTo('inventory', 'stock:low', ingredient);
      }
    }
  } catch (error) {
    // Notifications are not the critical path.
    console.error('[inventory] gagal mengirim notifikasi stok:', error.message);
  }
}

/**
 * Check all ingredients and emit notifications for those below minimum.
 * Can be called manually from the inventory page.
 */
async function checkLowStock() {
  const low = await ingredientService.lowStock();

  for (const ingredient of low) {
    await notificationService.create({
      type: 'STOCK',
      title: `Stok menipis: ${ingredient.name}`,
      message: `Stok ${ingredient.name} tersisa ${ingredient.stock} ${ingredient.unit} (minimum ${ingredient.minimumStock} ${ingredient.unit}).`,
      userId: null,
    });
  }

  socket.emitTo('inventory', 'stock:low-list', low);
  return low;
}

/**
 * Inventory summary for the dashboard/overview page.
 */
async function summary() {
  const [totals] = await query(
    `SELECT COUNT(*) AS total_ingredients,
            COALESCE(SUM(stock * unit_price), 0) AS total_value,
            COALESCE(SUM(CASE WHEN minimum_stock > 0 AND stock <= minimum_stock THEN 1 ELSE 0 END), 0) AS low_stock_count
       FROM ingredients
      WHERE is_active = 1`
  );

  const [movementRows] = await query(
    `SELECT type, COUNT(*) AS total
       FROM inventory_transactions
      WHERE created_at >= CURDATE()
      GROUP BY type`
  );

  const [recent] = await query(
    `SELECT t.id, t.type, t.quantity_in, t.quantity_out, t.created_at,
            i.name AS ingredient_name, i.unit, o.order_number
       FROM inventory_transactions t
       JOIN ingredients i ON i.id = t.ingredient_id
       LEFT JOIN orders o ON o.id = t.order_id
      ORDER BY t.id DESC
      LIMIT 10`
  );

  const movementsToday = {};
  for (const row of movementRows) {
    movementsToday[row.type] = Number(row.total);
  }

  return {
    totalIngredients: Number(totals[0].total_ingredients),
    totalValue: round(Number(totals[0].total_value)),
    lowStockCount: Number(totals[0].low_stock_count),
    movementsToday,
    recentMovements: recent.map((row) => ({
      id: Number(row.id),
      type: row.type,
      typeLabel: TYPE_LABELS[row.type] || row.type,
      ingredientName: row.ingredient_name,
      unit: row.unit,
      quantityIn: round(Number(row.quantity_in), QTY_DECIMALS),
      quantityOut: round(Number(row.quantity_out), QTY_DECIMALS),
      orderNumber: row.order_number,
      createdAt: row.created_at,
    })),
  };
}

module.exports = {
  TX_TYPES,
  TYPE_LABELS,
  QTY_DECIMALS,
  listMovements,
  hasDeductionForOrder,
  deductForOrder,
  restoreForOrder,
  adjustStock,
  recordPurchase,
  checkLowStock,
  summary,
  afterStockChange,
};