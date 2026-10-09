'use strict';

const notificationService = require('../services/notification.service');
const { ok } = require('../utils/response');

/** Controller notifikasi. */

/** GET /api/notifications */
async function list(req, res) {
  const result = await notificationService.list(req.user.id, {
    unreadOnly: req.query.unread === '1',
    limit: req.query.limit ? Number(req.query.limit) : 30,
    offset: req.query.offset ? Number(req.query.offset) : 0,
  });

  return ok(res, {
    data: result.rows,
    meta: { total: result.total, unread: result.unread },
    message: 'Daftar notifikasi.',
  });
}

/** GET /api/notifications/unread-count */
async function unreadCount(req, res) {
  const total = await notificationService.countUnread(req.user.id);
  return ok(res, { data: { total }, message: 'Jumlah notifikasi belum dibaca.' });
}

/** PATCH /api/notifications/:id/read  (kosongkan id berarti tandai semua) */
async function markRead(req, res) {
  const notificationId = req.params.id ? Number(req.params.id) : null;
  const result = await notificationService.markRead(notificationId, req.user.id);
  return ok(res, { data: result, message: 'Notifikasi ditandai sudah dibaca.' });
}

module.exports = { list, unreadCount, markRead };