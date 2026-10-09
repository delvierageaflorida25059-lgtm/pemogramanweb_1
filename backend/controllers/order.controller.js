'use strict';

const orderService = require('../services/order.service');
const ApiError = require('../utils/ApiError');
const { ok, paginated, getPagination } = require('../utils/response');
const { setAudit } = require('../middleware/audit');

/** Controller order. */

/** GET /api/orders */
async function list(req, res) {
  const { page, limit, offset } = getPagination(req);

  const statuses = req.query.status
    ? String(req.query.status).split(',').map((item) => item.trim()).filter(Boolean)
    : null;

  const result = await orderService.list({
    status: statuses,
    source: req.query.source || null,
    tableId: req.query.table_id ? Number(req.query.table_id) : null,
    customerId: req.query.customer_id ? Number(req.query.customer_id) : null,
    search: req.query.search?.trim() || null,
    from: req.query.from || null,
    to: req.query.to || null,
    limit,
    offset,
  });

  return paginated(res, req, { items: result.rows, total: result.total, page, limit });
}

/**
 * POST /api/orders
 *
 * sudah di-resolve server, sehingga tamu tidak perlu login.
 * sudah di-resolve server, sehingga tamu tidak perlu login.
 */
async function create(req, res) {
  const order = await orderService.create(req.body, req.user);

  setAudit(res, {
    userId: req.user ? req.user.id : null,
    action: 'CREATE',
    entityType: 'order',
    entityId: order.id,
    description: `Membuat order ${order.orderNumber} (${order.source})`,
    metadata: {
      tableCode: order.tableCode,
      total: order.total,
      itemCount: order.items ? order.items.length : null,
    },
  });

  return ok(res, { data: order, message: 'Order berhasil dibuat.', status: 201 });
}

/** GET /api/orders/:id */
async function detail(req, res) {
  const order = await orderService.findById(Number(req.params.id));
  if (!order) throw ApiError.notFound('Order tidak ditemukan.');
  return ok(res, { data: order, message: 'Detail order.' });
}

/**
 * GET /api/orders/track/:orderNumber
 *
 * Endpoint publik untuk halaman lacak pesanan. Membatasi data yang dikembalikan:
 * pelanggan tidak boleh melihat catatan internal maupun riwayat status lengkap.
 */
async function track(req, res) {
  const orderNumber = String(req.params.orderNumber || '').trim().toUpperCase();
  if (!orderNumber) throw ApiError.badRequest('Nomor order wajib diisi.');

  const { rows } = await orderService.list({ search: orderNumber, limit: 5 });
  const order = rows.find((item) => item.orderNumber === orderNumber);

  if (!order) {
    throw ApiError.notFound('Order dengan nomor tersebut tidak ditemukan.');
  }

  const full = await orderService.findById(order.id);

  return ok(res, {
    data: {
      id: full.id,
      orderNumber: full.orderNumber,
      status: full.status,
      tableCode: full.tableCode,
      // Rincian nilai ikut dikirim supaya pelanggan bisa melihat rincian
      // pajak dan service charge tanpa perlu endpoint internal.
      subtotal: full.subtotal,
      discountPercent: full.discountPercent,
      discountAmount: full.discountAmount,
      taxPercent: full.taxPercent,
      taxAmount: full.taxAmount,
      serviceChargePercent: full.serviceChargePercent,
      serviceChargeAmount: full.serviceChargeAmount,
      total: full.total,
      paidAmount: full.paidAmount,
      balanceDue: full.balanceDue,
      createdAt: full.createdAt,
      updatedAt: full.updatedAt,
      items: full.items.map((item) => ({
        productName: item.productName,
        variantName: item.variantName,
        quantity: item.quantity,
        lineTotal: item.lineTotal,
        addons: item.addons.map((addon) => ({ name: addon.name, quantity: addon.quantity })),
      })),
      // Hanya status terakhir yang ditampilkan, bukan riwayat internal.
      statusLabel: statusLabel(full.status),
      progress: buildProgress(full.status),
    },
    message: 'Status pesanan.',
  });
}

/** PATCH /api/orders/:id/status */
async function changeStatus(req, res) {
  const orderId = Number(req.params.id);
  const order = await orderService.changeStatus(
    orderId,
    req.body.status,
    req.user,
    req.body.note
  );

  setAudit(res, {
    action: 'CHANGE_STATUS',
    entityType: 'order',
    entityId: orderId,
    description: `Status ${order.orderNumber} diubah ke ${order.status}`,
    metadata: { status: order.status },
  });

  return ok(res, { data: order, message: `Status order diubah ke ${order.status}.` });
}

/** POST /api/orders/:id/cancel */
async function cancel(req, res) {
  const orderId = Number(req.params.id);
  const order = await orderService.cancel(orderId, req.body.reason, req.user);

  setAudit(res, {
    action: 'CANCEL',
    entityType: 'order',
    entityId: orderId,
    description: `Membatalkan order ${order.orderNumber}`,
    metadata: { reason: req.body.reason ?? null },
  });

  return ok(res, { data: order, message: 'Order berhasil dibatalkan.' });
}

/** GET /api/orders/table/:tableId/active */
async function activeByTable(req, res) {
  const order = await orderService.findActiveByTable(Number(req.params.tableId));
  return ok(res, {
    data: order,
    message: order ? 'Order aktif untuk meja ini.' : 'Tidak ada order aktif pada meja ini.',
  });
}

const STATUS_LABELS = {
  PENDING: 'Menunggu konfirmasi',
  CONFIRMED: 'Pesanan dikonfirmasi dapur',
  PREPARING: 'Sedang dimasak',
  READY: 'Pesanan siap diantar',
  COMPLETED: 'Pesanan selesai',
  CANCELLED: 'Pesanan dibatalkan',
};

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

/** Lima tahap untuk indikator progres di halaman pelanggan. */
function buildProgress(status) {
  const stages = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'COMPLETED'];
  if (status === 'CANCELLED') return [false, false, false, false, false];
  const index = stages.indexOf(status);
  return stages.map((_stage, i) => i <= index);
}

module.exports = { list, create, detail, track, changeStatus, cancel, activeByTable };
