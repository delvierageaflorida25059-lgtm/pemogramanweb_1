'use strict';

const express = require('express');
const inventoryController = require('../controllers/inventory.controller');
const ingredientController = require('../controllers/ingredient.controller');
const recipeController = require('../controllers/recipe.controller');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../utils/validators');
const ingredientService = require('../services/ingredient.service');

const router = express.Router();

router.use(requireAuth);

// ===========================================================================
//  Bahan baku
//  Permission: inventory.view untuk baca, inventory.manage untuk tulis.
// ===========================================================================

/** GET /api/inventory/ingredients */
router.get(
  '/ingredients',
  requirePermission('inventory.view'),
  validate({
    search: { type: 'string', max: 100 },
    active: { type: 'string', max: 1 },
    low_stock: { type: 'string', max: 1 },
  }),
  ingredientController.list
);

/** GET /api/inventory/ingredients/low-stock */
router.get(
  '/ingredients/low-stock',
  requirePermission('inventory.view'),
  ingredientController.lowStock
);

/** GET /api/inventory/ingredients/:id */
router.get(
  '/ingredients/:id',
  requirePermission('inventory.view'),
  ingredientController.detail
);

/** POST /api/inventory/ingredients */
router.post(
  '/ingredients',
  requirePermission('inventory.manage'),
  validate({
    code: { type: 'string', required: true, max: 30, label: 'Kode bahan' },
    name: { type: 'string', required: true, max: 150, label: 'Nama bahan' },
    unit: {
      type: 'enum',
      required: true,
      values: ingredientService.UNITS,
      label: 'Satuan',
    },
    stock: { type: 'number', min: 0, label: 'Stok awal' },
    minimum_stock: { type: 'number', min: 0, label: 'Stok minimum' },
    unit_price: { type: 'number', min: 0, label: 'Harga satuan' },
    is_active: { type: 'boolean' },
  }),
  ingredientController.create
);

/** PUT /api/inventory/ingredients/:id */
router.put(
  '/ingredients/:id',
  requirePermission('inventory.manage'),
  validate({
    code: { type: 'string', max: 30 },
    name: { type: 'string', max: 150 },
    unit: { type: 'enum', values: ingredientService.UNITS },
    minimum_stock: { type: 'number', min: 0 },
    unit_price: { type: 'number', min: 0 },
    is_active: { type: 'boolean' },
  }),
  ingredientController.update
);

/** DELETE /api/inventory/ingredients/:id */
router.delete(
  '/ingredients/:id',
  requirePermission('inventory.manage'),
  ingredientController.remove
);

// ===========================================================================
//  Recipe / BOM
// ===========================================================================

/** GET /api/inventory/recipes */
router.get(
  '/recipes',
  requirePermission('inventory.view'),
  validate({
    product_id: { type: 'integer', min: 1 },
    search: { type: 'string', max: 100 },
  }),
  recipeController.list
);

/** GET /api/inventory/recipes/products/:productId */
router.get(
  '/recipes/products/:productId',
  requirePermission('inventory.view'),
  recipeController.detail
);

/**
 * PUT /api/inventory/recipes/products/:productId
 * Isi item divalidasi di recipe.service agar pesan errornya bisa menyebut
 * nama bahan yang bermasalah.
 */
router.put(
  '/recipes/products/:productId',
  requirePermission('inventory.manage'),
  validate({
    name: { type: 'string', max: 150 },
    yield_quantity: { type: 'number', min: 0 },
    note: { type: 'string', max: 500 },
    is_active: { type: 'boolean' },
    items: { type: 'array', required: true, minItems: 1, label: 'Bahan recipe' },
  }),
  recipeController.save
);

/** DELETE /api/inventory/recipes/products/:productId */
router.delete(
  '/recipes/products/:productId',
  requirePermission('inventory.manage'),
  recipeController.deactivate
);

// ===========================================================================
//  Jurnal mutasi, penyesuaian, dan stock opname
// ===========================================================================

/** GET /api/inventory/summary */
router.get('/summary', requirePermission('inventory.view'), inventoryController.summary);

/** GET /api/inventory/movements */
router.get(
  '/movements',
  requirePermission('inventory.view'),
  validate({
    ingredient_id: { type: 'integer', min: 1 },
    order_id: { type: 'integer', min: 1 },
    type: { type: 'enum', values: ['PURCHASE', 'SALE', 'ADJUSTMENT', 'OPNAME', 'WASTE', 'VOID', 'RETURN'] },
    from: { type: 'string', max: 25 },
    to: { type: 'string', max: 25 },
  }),
  inventoryController.listMovements
);

/** POST /api/inventory/check-low-stock */
router.post(
  '/check-low-stock',
  requirePermission('inventory.view'),
  inventoryController.checkLowStock
);

/** POST /api/inventory/adjustment */
router.post(
  '/adjustment',
  requirePermission('inventory.manage'),
  validate({
    ingredient_id: { type: 'integer', required: true, min: 1, label: 'ID bahan' },
    direction: { type: 'enum', required: true, values: ['IN', 'OUT'], label: 'Arah' },
    quantity: { type: 'number', required: true, min: 0, label: 'Jumlah' },
    note: { type: 'string', max: 255, label: 'Keterangan' },
  }),
  inventoryController.adjustStock
);

/** POST /api/inventory/receive */
router.post(
  '/receive',
  requirePermission('inventory.manage'),
  validate({
    ingredient_id: { type: 'integer', required: true, min: 1, label: 'ID bahan' },
    quantity: { type: 'number', required: true, min: 0, label: 'Jumlah' },
    note: { type: 'string', max: 255, label: 'Keterangan' },
  }),
  inventoryController.receive
);

// --- Stock opname ----------------------------------------------------------

/** GET /api/inventory/opnames */
router.get(
  '/opnames',
  requirePermission('inventory.view'),
  validate({ status: { type: 'enum', values: ['DRAFT', 'APPROVED', 'CANCELLED'] } }),
  inventoryController.listOpnames
);

/** POST /api/inventory/opnames */
router.post(
  '/opnames',
  requirePermission('inventory.manage'),
  validate({
    note: { type: 'string', max: 500 },
    include_all: { type: 'boolean' },
  }),
  inventoryController.createOpname
);

/** GET /api/inventory/opnames/:id */
router.get(
  '/opnames/:id',
  requirePermission('inventory.view'),
  inventoryController.detailOpname
);

/** POST /api/inventory/opnames/:id/approve */
router.post(
  '/opnames/:id/approve',
  requirePermission('inventory.manage'),
  inventoryController.approveOpname
);

/** POST /api/inventory/opnames/:id/cancel */
router.post(
  '/opnames/:id/cancel',
  requirePermission('inventory.manage'),
  inventoryController.cancelOpname
);

/** PUT /api/inventory/opnames/:opnameId/items/:ingredientId */
router.put(
  '/opnames/:opnameId/items/:ingredientId',
  requirePermission('inventory.manage'),
  validate({
    physical_stock: { type: 'any', required: true, label: 'Hasil hitung fisik' },
    note: { type: 'string', max: 255 },
  }),
  inventoryController.recordPhysicalStock
);

module.exports = router;