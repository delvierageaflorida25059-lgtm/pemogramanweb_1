'use strict';

const ingredientService = require('../services/ingredient.service');
const inventoryService = require('../services/inventory.service');
const stockOpnameService = require('../services/stockOpname.service');
const ApiError = require('../utils/ApiError');
const { ok, paginated, getPagination } = require('../utils/response');
const { setAudit } = require('../middleware/audit');

/** Controller inventory: jurnal mutasi, penyesuaian, dan stock opname. */

// ---------------------------------------------------------------------------
// Ringkasan dan jurnal
// ---------------------------------------------------------------------------

/** GET /api/inventory/summary */
async function summary(_req, res) {
  const data = await inventoryService.summary();
  return ok(res, { data, message: 'Ringkasan inventory.' });
}

/** GET /api/inventory/movements */
async function listMovements(req, res) {
  const { page, limit, offset } = getPagination(req, { limit: 50 });

  const result = await inventoryService.listMovements({
    ingredientId: req.query.ingredient_id ? Number(req.query.ingredient_id) : null,
    type: req.query.type || null,
    orderId: req.query.order_id ? Number(req.query.order_id) : null,
    from: req.query.from || null,
    to: req.query.to || null,
    limit,
    offset,
  });

  return paginated(res, req, { items: result.rows, total: result.total, page, limit });
}

/** POST /api/inventory/check-low-stock */
async function checkLowStock(_req, res) {
  const low = await inventoryService.checkLowStock();
  return ok(res, {
    data: low,
    message: low.length > 0
      ? `${low.length} bahan baku perlu segera dibeli.`
      : 'Semua bahan baku masih di atas batas minimum.',
  });
}

// ---------------------------------------------------------------------------
// Penyesuaian stok manual
// ---------------------------------------------------------------------------

/** POST /api/inventory/adjustment */
async function adjustStock(req, res) {
  const result = await inventoryService.adjustStock(req.body, req.user);

  setAudit(res, {
    action: 'ADJUST_STOCK',
    entityType: 'ingredient',
    entityId: result.ingredientId,
    description: `Penyesuaian stok ${result.name} ${result.direction} ${result.quantity} ${result.unit}`,
    metadata: { stockBefore: result.stockBefore, stockAfter: result.stockAfter, note: req.body.note ?? null },
  });

  return ok(res, {
    data: result,
    message: `Stok ${result.name} disesuaikan menjadi ${result.stockAfter} ${result.unit}.`,
  });
}

/** POST /api/inventory/receive  -- barang masuk dari supplier */
async function receive(req, res) {
  const result = await inventoryService.recordPurchase(req.body, req.user);

  setAudit(res, {
    action: 'RECEIVE_STOCK',
    entityType: 'ingredient',
    entityId: result.ingredientId,
    description: `Barang masuk: ${result.name} +${result.quantity} ${result.unit}`,
    metadata: { stockBefore: result.stockBefore, stockAfter: result.stockAfter },
  });

  return ok(res, {
    data: result,
    message: `Barang masuk dicatat. Stok ${result.name} kini ${result.stockAfter} ${result.unit}.`,
    status: 201,
  });
}

// ---------------------------------------------------------------------------
// Stock opname
// ---------------------------------------------------------------------------

/** GET /api/inventory/opnames */
async function listOpnames(req, res) {
  const { page, limit, offset } = getPagination(req);

  const result = await stockOpnameService.list({
    status: req.query.status || null,
    limit,
    offset,
  });

  return paginated(res, req, { items: result.rows, total: result.total, page, limit });
}

/** POST /api/inventory/opnames */
async function createOpname(req, res) {
  const opname = await stockOpnameService.create(req.body, req.user);

  setAudit(res, {
    action: 'CREATE',
    entityType: 'stock_opname',
    entityId: opname.id,
    description: `Membuat stock opname ${opname.opnameNumber}`,
  });

  return ok(res, {
    data: opname,
    message: `Stock opname ${opname.opnameNumber} dibuat dengan ${opname.totalItems} bahan.`,
    status: 201,
  });
}

/** GET /api/inventory/opnames/:id */
async function detailOpname(req, res) {
  const opname = await stockOpnameService.findById(Number(req.params.id));
  if (!opname) throw ApiError.notFound('Stock opname tidak ditemukan.');
  return ok(res, { data: opname, message: 'Detail stock opname.' });
}

/** PUT /api/inventory/opnames/:opnameId/items/:ingredientId */
async function recordPhysicalStock(req, res) {
  const opnameId = Number(req.params.opnameId);
  const ingredientId = Number(req.params.ingredientId);

  const opname = await stockOpnameService.recordPhysicalStock(
    opnameId,
    ingredientId,
    req.body.physical_stock,
    req.body.note
  );

  return ok(res, { data: opname, message: 'Hasil hitung fisik disimpan.' });
}

/** POST /api/inventory/opnames/:id/approve */
async function approveOpname(req, res) {
  const opnameId = Number(req.params.id);
  const result = await stockOpnameService.approve(opnameId, req.user);

  setAudit(res, {
    action: 'APPROVE_OPNAME',
    entityType: 'stock_opname',
    entityId: opnameId,
    description: `Menyetujui stock opname ${result.opname.opnameNumber}`,
    metadata: {
      adjustedCount: result.adjusted.length,
      totalDifference: result.opname.totalDifference,
    },
  });

  return ok(res, {
    data: result,
    message:
      `Stock opname ${result.opname.opnameNumber} disetujui. ` +
      `${result.adjusted.length} bahan disesuaikan.`,
  });
}

/** POST /api/inventory/opnames/:id/cancel */
async function cancelOpname(req, res) {
  const opnameId = Number(req.params.id);
  const opname = await stockOpnameService.cancel(opnameId, req.user);

  setAudit(res, {
    action: 'CANCEL_OPNAME',
    entityType: 'stock_opname',
    entityId: opnameId,
    description: `Membatalkan stock opname ${opname.opnameNumber}`,
  });

  return ok(res, { data: opname, message: 'Stock opname dibatalkan.' });
}

module.exports = {
  summary,
  listMovements,
  checkLowStock,
  adjustStock,
  receive,
  listOpnames,
  createOpname,
  detailOpname,
  recordPhysicalStock,
  approveOpname,
  cancelOpname,
};