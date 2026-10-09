'use strict';

const express = require('express');
const orderController = require('../controllers/order.controller');
const { optionalAuth, requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../utils/validators');

const router = express.Router();

// ---------------------------------------------------------------------------
// Endpoint publik: tamu yang memindai QR tidak punya akun.
// ---------------------------------------------------------------------------

/**
 * GET /api/orders/track/:orderNumber
 * Halaman lacak pesanan. Data yang dikembalikan sudah dibatasi di controller.
 */
router.get(
  '/track/:orderNumber',
  optionalAuth,
  validate({ orderNumber: { type: 'string', max: 30, label: 'Nomor order' } }),
  orderController.track
);

/**
 * POST /api/orders
 *_one endpoint_ untuk tamu (QR) dan staff (POS), karena payload-nya sama.
 * Harga tetap divalidasi ulang di server pada kedua kasus.
 */
router.post(
  '/',
  optionalAuth,
  validate({
    source: { type: 'enum', values: ['QR', 'POS'] },
    tableToken: { type: 'string', max: 64 },
    table_id: { type: 'integer', min: 1 },
    discount_percent: { type: 'number', min: 0, max: 100 },
    note: { type: 'string', max: 500, label: 'Catatan' },
    // Objek customer dan isi tiap item divalidasi di service, bukan di sini,
    // supaya pesan error bisa menyebut nama produk yang bermasalah.
    customer: { type: 'any' },
    items: { type: 'array', required: true, minItems: 1, label: 'Item pesanan' },
  }),
  orderController.create
);

// ---------------------------------------------------------------------------
// Endpoint staff
// ---------------------------------------------------------------------------

router.use(requireAuth);

/** GET /api/orders */
router.get(
  '/',
  requirePermission('order.view'),
  validate({
    status: { type: 'string', max: 100 },
    source: { type: 'enum', values: ['QR', 'POS'] },
    table_id: { type: 'integer', min: 1 },
    customer_id: { type: 'integer', min: 1 },
    search: { type: 'string', max: 100 },
    from: { type: 'string', max: 25 },
    to: { type: 'string', max: 25 },
  }),
  orderController.list
);

/** GET /api/orders/table/:tableId/active */
router.get(
  '/table/:tableId/active',
  requirePermission('order.view'),
  orderController.activeByTable
);

/** GET /api/orders/:id */
router.get('/:id', requirePermission('order.view'), orderController.detail);

/** PATCH /api/orders/:id/status */
router.patch(
  '/:id/status',
  requirePermission('kitchen.process'),
  validate({
    status: {
      type: 'enum',
      required: true,
      values: ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'],
      label: 'Status',
    },
    note: { type: 'string', max: 255 },
  }),
  orderController.changeStatus
);

/** POST /api/orders/:id/cancel */
router.post(
  '/:id/cancel',
  requirePermission('order.cancel'),
  validate({ reason: { type: 'string', max: 255, label: 'Alasan pembatalan' } }),
  orderController.cancel
);

module.exports = router;