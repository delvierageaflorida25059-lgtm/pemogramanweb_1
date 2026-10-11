'use strict';

const ingredientService = require('../services/ingredient.service');
const { ok, paginated, getPagination } = require('../utils/response');
const { setAudit } = require('../middleware/audit');

/** Controller bahan baku. */

/** GET /api/inventory/ingredients */
async function list(req, res) {
  const { page, limit, offset } = getPagination(req, { limit: 50 });

  const result = await ingredientService.list({
    search: req.query.search?.trim() || null,
    activeOnly: req.query.active === '1',
    lowStockOnly: req.query.low_stock === '1',
    limit,
    offset,
  });

  return paginated(res, req, { items: result.rows, total: result.total, page, limit });
}

/** GET /api/inventory/ingredients/:id */
async function detail(req, res) {
  const ingredient = await ingredientService.findById(Number(req.params.id));
  if (!ingredient) {
    return res.status(404).json({ success: false, message: 'Bahan baku tidak ditemukan.' });
  }
  return ok(res, { data: ingredient, message: 'Detail bahan baku.' });
}

/** GET /api/inventory/ingredients/low-stock */
async function lowStock(req, res) {
  const items = await ingredientService.lowStock();
  return ok(res, { data: items, message: 'Bahan baku yang stoknya menipis.' });
}

/** POST /api/inventory/ingredients */
async function create(req, res) {
  const ingredient = await ingredientService.create(req.body);

  setAudit(res, {
    action: 'CREATE',
    entityType: 'ingredient',
    entityId: ingredient.id,
    description: `Membuat bahan baku "${ingredient.name}"`,
    metadata: { unit: ingredient.unit, initialStock: ingredient.stock },
  });

  return ok(res, { data: ingredient, message: 'Bahan baku berhasil dibuat.', status: 201 });
}

/** PUT /api/inventory/ingredients/:id */
async function update(req, res) {
  const id = Number(req.params.id);
  const ingredient = await ingredientService.update(id, req.body);

  setAudit(res, {
    action: 'UPDATE',
    entityType: 'ingredient',
    entityId: id,
    description: `Memperbarui bahan baku "${ingredient.name}"`,
    metadata: { fields: Object.keys(req.body) },
  });

  return ok(res, { data: ingredient, message: 'Bahan baku berhasil diperbarui.' });
}

/** DELETE /api/inventory/ingredients/:id */
async function remove(req, res) {
  const id = Number(req.params.id);
  await ingredientService.remove(id);

  setAudit(res, {
    action: 'DELETE',
    entityType: 'ingredient',
    entityId: id,
    description: `Menonaktifkan bahan baku #${id}`,
  });

  return ok(res, {
    data: { id, is_active: false },
    message: 'Bahan baku dinonaktifkan.',
  });
}

module.exports = { list, detail, lowStock, create, update, remove };