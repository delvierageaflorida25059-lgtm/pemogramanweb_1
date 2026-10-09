'use strict';

const productService = require('../services/product.service');
const { ok, paginated, getPagination } = require('../utils/response');
const { setAudit } = require('../middleware/audit');

/** Controller produk, varian, dan addon. */

/** GET /api/products */
async function list(req, res) {
  const { page, limit, offset } = getPagination(req, { limit: 50 });

  const result = await productService.list({
    categoryId: req.query.category_id ? Number(req.query.category_id) : null,
    search: req.query.search?.trim() || null,
    activeOnly: req.query.active === '1',
    availableOnly: req.query.available === '1',
    limit,
    offset,
  });

  return paginated(res, req, { items: result.rows, total: result.total, page, limit });
}

/** GET /api/products/:id */
async function detail(req, res) {
  const product = await productService.findById(Number(req.params.id));
  if (!product) {
    return res.status(404).json({ success: false, message: 'Produk tidak ditemukan.' });
  }
  return ok(res, { data: product, message: 'Detail produk.' });
}

/** POST /api/products */
async function create(req, res) {
  const product = await productService.create(req.body);

  setAudit(res, {
    action: 'CREATE',
    entityType: 'product',
    entityId: product.id,
    description: `Membuat produk "${product.name}"`,
  });

  return ok(res, { data: product, message: 'Produk berhasil dibuat.', status: 201 });
}

/** PUT /api/products/:id */
async function update(req, res) {
  const id = Number(req.params.id);
  const product = await productService.update(id, req.body);

  setAudit(res, {
    action: 'UPDATE',
    entityType: 'product',
    entityId: id,
    description: `Memperbarui produk "${product.name}"`,
  });

  return ok(res, { data: product, message: 'Produk berhasil diperbarui.' });
}

/** DELETE /api/products/:id */
async function remove(req, res) {
  const id = Number(req.params.id);
  const result = await productService.remove(id);

  setAudit(res, {
    action: 'DELETE',
    entityType: 'product',
    entityId: id,
    description: `Menonaktifkan produk #${id}`,
  });

  return ok(res, {
    data: result,
    message: 'Produk dinonaktifkan dan hilang dari daftar menu.',
  });
}

/** PATCH /api/products/:id/stock-status */
async function setStockStatus(req, res) {
  const id = Number(req.params.id);
  const product = await productService.setStockStatus(id, req.body.stock_status);

  setAudit(res, {
    action: 'UPDATE',
    entityType: 'product',
    entityId: id,
    description: `Status stok "${product.name}" diubah ke ${req.body.stock_status}`,
  });

  return ok(res, { data: product, message: 'Status stok berhasil diperbarui.' });
}

// ---------------------------------------------------------------------------
// Varian
// ---------------------------------------------------------------------------

/** POST /api/products/:id/variants */
async function addVariant(req, res) {
  const productId = Number(req.params.id);
  const product = await productService.addVariant(productId, req.body);

  setAudit(res, {
    action: 'CREATE',
    entityType: 'product_variant',
    entityId: productId,
    description: `Menambah varian "${req.body.name}" pada produk #${productId}`,
  });

  return ok(res, { data: product, message: 'Varian berhasil ditambahkan.', status: 201 });
}

/** PUT /api/products/:id/variants/:variantId */
async function updateVariant(req, res) {
  const productId = Number(req.params.id);
  const product = await productService.updateVariant(
    productId,
    Number(req.params.variantId),
    req.body
  );

  setAudit(res, {
    action: 'UPDATE',
    entityType: 'product_variant',
    entityId: Number(req.params.variantId),
    description: `Memperbarui varian #${req.params.variantId}`,
  });

  return ok(res, { data: product, message: 'Varian berhasil diperbarui.' });
}

/** DELETE /api/products/:id/variants/:variantId */
async function removeVariant(req, res) {
  const productId = Number(req.params.id);
  await productService.removeVariant(productId, Number(req.params.variantId));

  setAudit(res, {
    action: 'DELETE',
    entityType: 'product_variant',
    entityId: Number(req.params.variantId),
    description: `Menghapus varian #${req.params.variantId}`,
  });

  return ok(res, { data: { id: Number(req.params.variantId) }, message: 'Varian dihapus.' });
}

// ---------------------------------------------------------------------------
// Addon
// ---------------------------------------------------------------------------

/** POST /api/products/:id/addons */
async function addAddon(req, res) {
  const productId = Number(req.params.id);
  const product = await productService.addAddon(productId, req.body);

  setAudit(res, {
    action: 'CREATE',
    entityType: 'product_addon',
    entityId: productId,
    description: `Menambah addon "${req.body.name}"`,
  });

  return ok(res, { data: product, message: 'Addon berhasil ditambahkan.', status: 201 });
}

/** PUT /api/products/:id/addons/:addonId */
async function updateAddon(req, res) {
  const productId = Number(req.params.id);
  const product = await productService.updateAddon(
    productId,
    Number(req.params.addonId),
    req.body
  );

  setAudit(res, {
    action: 'UPDATE',
    entityType: 'product_addon',
    entityId: Number(req.params.addonId),
    description: `Memperbarui addon #${req.params.addonId}`,
  });

  return ok(res, { data: product, message: 'Addon berhasil diperbarui.' });
}

/** DELETE /api/products/:id/addons/:addonId */
async function removeAddon(req, res) {
  const productId = Number(req.params.id);
  await productService.removeAddon(productId, Number(req.params.addonId));

  setAudit(res, {
    action: 'DELETE',
    entityType: 'product_addon',
    entityId: Number(req.params.addonId),
    description: `Menghapus addon #${req.params.addonId}`,
  });

  return ok(res, { data: { id: Number(req.params.addonId) }, message: 'Addon dihapus.' });
}

module.exports = {
  list,
  detail,
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
};