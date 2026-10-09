'use strict';

const express = require('express');
const paymentController = require('../controllers/payment.controller');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../utils/validators');

const router = express.Router();

router.use(requireAuth);

/**
 * POST /api/payments/refund
 * Didaftarkan sebelum "/:id" agar path "refund" tidak tertangkap sebagai id.
 */
router.post(
  '/refund',
  requirePermission('payment.refund'),
  validate({
    payment_id: { type: 'integer', required: true, min: 1, label: 'ID pembayaran' },
    amount: { type: 'number', min: 0, label: 'Nominal refund' },
    reason: { type: 'string', max: 255, label: 'Alasan refund' },
  }),
  paymentController.refund
);

/** GET /api/payments */
router.get(
  '/',
  requirePermission('payment.view'),
  validate({
    order_id: { type: 'integer', min: 1 },
    method: { type: 'enum', values: ['CASH', 'TRANSFER', 'QRIS', 'CARD'] },
    status: {
      type: 'enum',
      values: ['PENDING', 'SUCCESS', 'FAILED', 'REFUNDED', 'PARTIAL_REFUND'],
    },
    from: { type: 'string', max: 25 },
    to: { type: 'string', max: 25 },
  }),
  paymentController.list
);

/** POST /api/payments */
router.post(
  '/',
  requirePermission('payment.create'),
  validate({
    order_id: { type: 'integer', required: true, min: 1, label: 'ID order' },
    method: {
      type: 'enum',
      required: true,
      values: ['CASH', 'TRANSFER', 'QRIS', 'CARD'],
      label: 'Metode pembayaran',
    },
    amount: { type: 'number', min: 0, label: 'Nominal' },
    tender: { type: 'number', min: 0, label: 'Uang diterima' },
    reference: { type: 'string', max: 100 },
    note: { type: 'string', max: 255 },
  }),
  paymentController.create
);

/** GET /api/payments/:id */
router.get('/:id', requirePermission('payment.view'), paymentController.detail);

module.exports = router;