'use strict';

const express = require('express');
const categoryController = require('../controllers/category.controller');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../utils/validators');

const router = express.Router();

router.use(requireAuth);

/** GET /api/categories */
router.get(
  '/',
  requirePermission('category.view'),
  validate({
    active: { type: 'string', max: 1 },
    search: { type: 'string', max: 100 },
  }),
  categoryController.list
);

/** GET /api/categories/:id */
router.get('/:id', requirePermission('category.view'), categoryController.detail);

/** POST /api/categories */
router.post(
  '/',
  requirePermission('category.manage'),
  validate({
    name: { type: 'string', required: true, max: 100, label: 'Nama kategori' },
    description: { type: 'string', max: 255 },
    sort_order: { type: 'integer', min: 0 },
    is_active: { type: 'boolean' },
  }),
  categoryController.create
);

/** PUT /api/categories/:id */
router.put(
  '/:id',
  requirePermission('category.manage'),
  validate({
    name: { type: 'string', max: 100 },
    description: { type: 'string', max: 255 },
    sort_order: { type: 'integer', min: 0 },
    is_active: { type: 'boolean' },
  }),
  categoryController.update
);

/** DELETE /api/categories/:id */
router.delete('/:id', requirePermission('category.manage'), categoryController.remove);

module.exports = router;