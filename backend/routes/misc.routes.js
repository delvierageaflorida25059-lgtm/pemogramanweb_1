'use strict';

const express = require('express');
const notificationController = require('../controllers/notification.controller');
const dashboardController = require('../controllers/dashboard.controller');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../utils/validators');

const router = express.Router();

router.use(requireAuth);

// ---------------------------------------------------------------------------
// Notifikasi
// ---------------------------------------------------------------------------

/** GET /api/notifications/unread-count */
router.get('/unread-count', notificationController.unreadCount);

/** GET /api/notifications */
router.get(
  '/',
  validate({
    unread: { type: 'string', max: 1 },
    limit: { type: 'integer', min: 1, max: 100 },
    offset: { type: 'integer', min: 0 },
  }),
  notificationController.list
);

/** PATCH /api/notifications/read-all */
router.patch('/read-all', notificationController.markRead);

/** PATCH /api/notifications/:id/read */
router.patch('/:id/read', notificationController.markRead);

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/** GET /api/dashboard/summary */
router.get('/summary', requirePermission('report.view'), dashboardController.summary);

/** GET /api/dashboard/daily?date=YYYY-MM-DD */
router.get(
  '/daily',
  requirePermission('report.finance'),
  validate({ date: { type: 'string', max: 10, label: 'Tanggal' } }),
  dashboardController.daily
);

module.exports = router;