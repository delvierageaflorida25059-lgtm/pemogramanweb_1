'use strict';

const express = require('express');
const kitchenController = require('../controllers/kitchen.controller');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../utils/validators');

const router = express.Router();

router.use(requireAuth);

/** GET /api/kitchen/board */
router.get('/board', requirePermission('kitchen.view'), kitchenController.board);

/** PATCH /api/kitchen/orders/:id/status */
router.patch(
  '/orders/:id/status',
  requirePermission('kitchen.process'),
  validate({
    status: {
      type: 'enum',
      required: true,
      // Hanya tahap yang boleh dilakukan dapur. Endpoint /
      //orders/:id/status milik modul order juga bisa mengubah status penuh.
      values: ['CONFIRMED', 'PREPARING', 'READY', 'COMPLETED'],
      label: 'Status',
    },
    note: { type: 'string', max: 255 },
  }),
  kitchenController.advance
);

module.exports = router;