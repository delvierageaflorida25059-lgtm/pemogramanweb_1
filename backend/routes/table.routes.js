'use strict';

const express = require('express');
const tableController = require('../controllers/table.controller');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../utils/validators');

const router = express.Router();

/**
 * Endpoint publik yang dipanggil setelah pelanggan memindai QR.
 * Harus didaftarkan sebelum router.use(requireAuth).
 */
router.get(
  '/public/resolve',
  validate({ token: { type: 'string', required: true, max: 64, label: 'Token QR' } }),
  tableController.resolveToken
);

router.use(requireAuth);

/** GET /api/tables/qr/list */
router.get('/qr/list', requirePermission('table.qr'), tableController.listQr);

/**
 * GET /api/tables/:id/qr.png
 * Didaftarkan sebelum "/:id" agar path "/:id/qr.png" tidak tertangkap sebagai id.
 */
router.get(
  '/:id/qr.png',
  requirePermission('table.qr'),
  validate({ width: { type: 'integer', min: 120, max: 1200 } }),
  tableController.qrImage
);

/** GET /api/tables */
router.get(
  '/',
  requirePermission('table.view'),
  validate({
    status: {
      type: 'enum',
      values: ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'DISABLED'],
    },
    zone: { type: 'string', max: 50 },
    active: { type: 'string', max: 1 },
  }),
  tableController.list
);

/** GET /api/tables/:id */
router.get('/:id', requirePermission('table.view'), tableController.detail);

/** POST /api/tables/:id/qr */
router.post('/:id/qr', requirePermission('table.qr'), tableController.regenerateQr);

/** POST /api/tables */
router.post(
  '/',
  requirePermission('table.manage'),
  validate({
    code: { type: 'string', required: true, max: 20, label: 'Kode meja' },
    name: { type: 'string', max: 100, label: 'Nama meja' },
    zone: { type: 'string', max: 50, label: 'Area' },
    capacity: { type: 'integer', min: 1, max: 100, label: 'Kapasitas' },
    status: {
      type: 'enum',
      values: ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'DISABLED'],
    },
    is_active: { type: 'boolean' },
  }),
  tableController.create
);

/** PUT /api/tables/:id */
router.put(
  '/:id',
  requirePermission('table.manage'),
  validate({
    code: { type: 'string', max: 20 },
    name: { type: 'string', max: 100 },
    zone: { type: 'string', max: 50 },
    capacity: { type: 'integer', min: 1, max: 100 },
    status: {
      type: 'enum',
      values: ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'DISABLED'],
    },
    is_active: { type: 'boolean' },
  }),
  tableController.update
);

/** DELETE /api/tables/:id */
router.delete('/:id', requirePermission('table.manage'), tableController.remove);

module.exports = router;