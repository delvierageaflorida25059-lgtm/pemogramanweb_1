'use strict';

const express = require('express');
const productController = require('../controllers/product.controller');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../utils/validators');

const router = express.Router();

router.use(requireAuth);

/** GET /api/products */
router.get(
  '/',
  requirePermission('product.view'),
  validate({
    category_id: { type: 'integer', min: 1 },
    search: { type: 'string', max: 100 },
    active: { type: 'string', max: 1 },
    available: { type: 'string', max: 1 },
  }),
  productController.list
);

/** GET /api/products/:id */
router.get('/:id', requirePermission('product.view'), productController.detail);

// ---------------------------------------------------------------------------
// Varian dan addon.
// Didaftarkan SEBELUM "/:id" agar tidak tertangkap sebagai id produk.
// ---------------------------------------------------------------------------

/** POST /api/products/:id/variants */
router.post(
  '/:id/variants',
  requirePermission('product.manage'),
  validate({
    name: { type: 'string', required: true, max: 100, label: 'Nama varian' },
    price: { type: 'number', min: 0 },
    is_default: { type: 'boolean' },
    is_active: { type: 'boolean' },
    sort_order: { type: 'integer', min: 0 },
  }),
  productController.addVariant
);

/** PUT /api/products/:id/variants/:variantId */
router.put(
  '/:id/variants/:variantId',
  requirePermission('product.manage'),
  validate({
    name: { type: 'string', max: 100 },
    price: { type: 'number', min: 0 },
    is_default: { type: 'boolean' },
    is_active: { type: 'boolean' },
    sort_order: { type: 'integer', min: 0 },
  }),
  productController.updateVariant
);

/** DELETE /api/products/:id/variants/:variantId */
router.delete(
  '/:id/variants/:variantId',
  requirePermission('product.manage'),
  productController.removeVariant
);

/** POST /api/products/:id/addons */
router.post(
  '/:id/addons',
  requirePermission('product.manage'),
  validate({
    name: { type: 'string', required: true, max: 100, label: 'Nama addon' },
    price: { type: 'number', required: true, min: 0, label: 'Harga addon' },
    apply_to_category: { type: 'boolean' },
    is_active: { type: 'boolean' },
  }),
  productController.addAddon
);

/** PUT /api/products/:id/addons/:addonId */
router.put(
  '/:id/addons/:addonId',
  requirePermission('product.manage'),
  validate({
    name: { type: 'string', max: 100 },
    price: { type: 'number', min: 0 },
    is_active: { type: 'boolean' },
  }),
  productController.updateAddon
);

/** DELETE /api/products/:id/addons/:addonId */
router.delete(
  '/:id/addons/:addonId',
  requirePermission('product.manage'),
  productController.removeAddon
);

// ---------------------------------------------------------------------------
// Produk
// ---------------------------------------------------------------------------

/** POST /api/products */
router.post(
  '/',
  requirePermission('product.manage'),
  validate({
    category_id: { type: 'integer', required: true, min: 1, label: 'Kategori' },
    code: { type: 'string', required: true, max: 30, label: 'Kode produk' },
    name: { type: 'string', required: true, max: 150, label: 'Nama produk' },
    description: { type: 'string', max: 2000 },
    price: { type: 'number', required: true, min: 0, label: 'Harga' },
    image_url: { type: 'string', max: 255 },
    stock_status: { type: 'enum', values: ['AVAILABLE', 'UNAVAILABLE'] },
    is_active: { type: 'boolean' },
    sort_order: { type: 'integer', min: 0 },
  }),
  productController.create
);

/** PUT /api/products/:id */
router.put(
  '/:id',
  requirePermission('product.manage'),
  validate({
    category_id: { type: 'integer', min: 1 },
    code: { type: 'string', max: 30 },
    name: { type: 'string', max: 150 },
    description: { type: 'string', max: 2000 },
    price: { type: 'number', min: 0 },
    image_url: { type: 'string', max: 255 },
    stock_status: { type: 'enum', values: ['AVAILABLE', 'UNAVAILABLE'] },
    is_active: { type: 'boolean' },
    sort_order: { type: 'integer', min: 0 },
  }),
  productController.update
);

/** PATCH /api/products/:id/stock-status */
router.patch(
  '/:id/stock-status',
  requirePermission('product.manage'),
  validate({
    stock_status: {
      type: 'enum',
      required: true,
      values: ['AVAILABLE', 'UNAVAILABLE'],
      label: 'Status stok',
    },
  }),
  productController.setStockStatus
);

/**
 * DELETE /api/products/:id
 * Produk yang sudah pernah dipesan tidak dihapus fisik, hanya dinonaktifkan.
 */
router.delete('/:id', requirePermission('product.delete'), productController.remove);

module.exports = router;