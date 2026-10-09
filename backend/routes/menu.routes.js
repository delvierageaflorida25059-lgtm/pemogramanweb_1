'use strict';

const express = require('express');
const productController = require('../controllers/product.controller');
const categoryController = require('../controllers/category.controller');
const { optionalAuth, requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../utils/validators');

const router = express.Router();

// ---------------------------------------------------------------------------
// Endpoint publik untuk halaman menu pelanggan.
// Tidak butuh login. Price tetap diambil dari server, bukan dikirim client.
// ---------------------------------------------------------------------------

/** GET /api/menu/categories */
router.get(
  '/categories',
  optionalAuth,
  validate({ active: { type: 'string', max: 1 } }),
  categoryController.list
);

/**
 * GET /api/menu/products
 * Endpoint utama halaman menu. `available=1` dipakai untuk menyaring produk
 * yang sedang kosong.
 */
router.get(
  '/products',
  optionalAuth,
  validate({
    category_id: { type: 'integer', min: 1 },
    search: { type: 'string', max: 100 },
    available: { type: 'string', max: 1 },
  }),
  productController.list
);

// ---------------------------------------------------------------------------
// Endpoint yang butuh login
// ---------------------------------------------------------------------------

router.use(requireAuth);

/** GET /api/menu/products/:id */
router.get('/products/:id', requirePermission('product.view'), productController.detail);

module.exports = router;