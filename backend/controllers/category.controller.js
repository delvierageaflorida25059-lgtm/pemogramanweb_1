'use strict';

const categoryService = require('../services/category.service');
const { ok } = require('../utils/response');
const { setAudit } = require('../middleware/audit');

/** Controller kategori menu. */

/** GET /api/categories */
async function list(req, res) {
  const categories = await categoryService.list({
    activeOnly: req.query.active === '1',
    search: req.query.search?.trim() || null,
  });
  return ok(res, { data: categories, message: 'Daftar kategori.' });
}

/** GET /api/categories/:id */
async function detail(req, res) {
  const category = await categoryService.findById(Number(req.params.id));
  if (!category) {
    return res.status(404).json({ success: false, message: 'Kategori tidak ditemukan.' });
  }
  return ok(res, { data: category, message: 'Detail kategori.' });
}

/** POST /api/categories */
async function create(req, res) {
  const category = await categoryService.create(req.body);

  setAudit(res, {
    action: 'CREATE',
    entityType: 'category',
    entityId: category.id,
    description: `Membuat kategori "${category.name}"`,
  });

  return ok(res, { data: category, message: 'Kategori berhasil dibuat.', status: 201 });
}

/** PUT /api/categories/:id */
async function update(req, res) {
  const id = Number(req.params.id);
  const category = await categoryService.update(id, req.body);

  setAudit(res, {
    action: 'UPDATE',
    entityType: 'category',
    entityId: id,
    description: `Memperbarui kategori "${category.name}"`,
  });

  return ok(res, { data: category, message: 'Kategori berhasil diperbarui.' });
}

/** DELETE /api/categories/:id */
async function remove(req, res) {
  const id = Number(req.params.id);
  await categoryService.remove(id);

  setAudit(res, {
    action: 'DELETE',
    entityType: 'category',
    entityId: id,
    description: `Menghapus kategori #${id}`,
  });

  return ok(res, { data: { id }, message: 'Kategori berhasil dihapus.' });
}

module.exports = { list, detail, create, update, remove };