'use strict';

const paymentService = require('../services/payment.service');
const { ok, paginated, getPagination } = require('../utils/response');
const { setAudit } = require('../middleware/audit');

/** Controller pembayaran (simulasi Fase 1-3). */

/** POST /api/payments */
async function create(req, res) {
  const result = await paymentService.create(req.body, req.user);

  setAudit(res, {
    action: 'CREATE',
    entityType: 'payment',
    entityId: result.paymentId,
    description: `Mencatat pembayaran ${req.body.method} untuk order ${result.orderNumber}`,
    metadata: {
      amount: result.amount,
      method: req.body.method,
      change: result.changeAmount,
      fullyPaid: result.isFullyPaid,
    },
  });

  const message = result.isFullyPaid
    ? `Pembayaran diterima. Order ${result.orderNumber} lunas.`
    : `Pembayaran diterima. Sisa tagihan ${result.remaining}.`;

  return ok(res, { data: result, message, status: 201 });
}

/** GET /api/payments */
async function list(req, res) {
  const { page, limit, offset } = getPagination(req);

  const result = await paymentService.list({
    orderId: req.query.order_id ? Number(req.query.order_id) : null,
    method: req.query.method || null,
    status: req.query.status || null,
    from: req.query.from || null,
    to: req.query.to || null,
    limit,
    offset,
  });

  return paginated(res, req, { items: result.rows, total: result.total, page, limit });
}

/** GET /api/payments/:id */
async function detail(req, res) {
  const payment = await paymentService.findById(Number(req.params.id));
  if (!payment) {
    return res.status(404).json({ success: false, message: 'Pembayaran tidak ditemukan.' });
  }
  return ok(res, { data: payment, message: 'Detail pembayaran.' });
}

/** POST /api/payments/refund */
async function refund(req, res) {
  const result = await paymentService.refund(req.body, req.user);

  return ok(res, {
    data: result,
    message: result.orderCancelled
      ? 'Refund penuh diproses dan order dibatalkan.'
      : 'Refund berhasil diproses.',
  });
}

module.exports = { create, list, detail, refund };