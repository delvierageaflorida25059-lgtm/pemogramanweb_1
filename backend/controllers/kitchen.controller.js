'use strict';

const kitchenService = require('../services/kitchen.service');
const { ok } = require('../utils/response');
const { setAudit } = require('../middleware/audit');

/** Controller Kitchen Display System. */

/** GET /api/kitchen/board */
async function board(_req, res) {
  const data = await kitchenService.board();
  return ok(res, { data, message: 'Papan dapur.' });
}

/**
 * PATCH /api/kitchen/orders/:id/status
 *
 * Satu-satunya endpoint yang dipakai dapur untuk advancing order.
 * Transisi status divalidasi lagi di service, jadi request-crafted tidak
 * bisa melompati tahap.
 */
async function advance(req, res) {
  const orderId = Number(req.params.id);
  const order = await kitchenService.advance(orderId, req.body.status, req.user, req.body.note);

  setAudit(res, {
    action: 'KITCHEN_ADVANCE',
    entityType: 'order',
    entityId: orderId,
    description: `Dapur: ${order.orderNumber} -> ${order.status}`,
    metadata: { status: order.status, tableCode: order.tableCode },
  });

  return ok(res, { data: order, message: `Order ${order.orderNumber} kini ${order.status}.` });
}

module.exports = { board, advance };