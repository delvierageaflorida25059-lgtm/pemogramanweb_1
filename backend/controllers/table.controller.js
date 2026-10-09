'use strict';

const tableService = require('../services/table.service');
const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/response');
const { setAudit } = require('../middleware/audit');

/** Controller meja restoran dan QR code. */

/** GET /api/tables */
async function list(req, res) {
  const tables = await tableService.list({
    status: req.query.status || null,
    zone: req.query.zone || null,
    activeOnly: req.query.active === '1',
  });
  return ok(res, { data: tables, message: 'Daftar meja.' });
}

/** GET /api/tables/:id */
async function detail(req, res) {
  const table = await tableService.findById(Number(req.params.id));
  if (!table) throw ApiError.notFound('Meja tidak ditemukan.');
  return ok(res, { data: table, message: 'Detail meja.' });
}

/** POST /api/tables */
async function create(req, res) {
  const table = await tableService.create(req.body);

  setAudit(res, {
    action: 'CREATE',
    entityType: 'restaurant_table',
    entityId: table.id,
    description: `Membuat meja "${table.code}"`,
  });

  return ok(res, { data: table, message: 'Meja berhasil dibuat.', status: 201 });
}

/** PUT /api/tables/:id */
async function update(req, res) {
  const id = Number(req.params.id);
  const table = await tableService.update(id, req.body);

  setAudit(res, {
    action: 'UPDATE',
    entityType: 'restaurant_table',
    entityId: id,
    description: `Memperbarui meja "${table.code}"`,
  });

  return ok(res, { data: table, message: 'Meja berhasil diperbarui.' });
}

/** DELETE /api/tables/:id */
async function remove(req, res) {
  const id = Number(req.params.id);
  await tableService.remove(id);

  setAudit(res, {
    action: 'DELETE',
    entityType: 'restaurant_table',
    entityId: id,
    description: `Menghapus meja #${id}`,
  });

  return ok(res, { data: { id }, message: 'Meja berhasil dihapus.' });
}

/** POST /api/tables/:id/qr  -> terbitkan ulang token QR */
async function regenerateQr(req, res) {
  const id = Number(req.params.id);
  const qr = await tableService.issueQr(id, req.body?.label);

  setAudit(res, {
    action: 'REGENERATE_QR',
    entityType: 'restaurant_table',
    entityId: id,
    description: `Menerbitkan ulang QR untuk meja #${id}`,
  });

  return ok(res, { data: qr, message: 'QR code baru berhasil diterbitkan.' });
}

/** GET /api/tables/qr/list -> semua QR aktif untuk dicetak */
async function listQr(_req, res) {
  const codes = await tableService.listActiveQrCodes();
  return ok(res, { data: codes, message: 'Daftar QR code aktif.' });
}

/**
 * GET /api/tables/public/resolve?token=...
 *
 * Endpoint PUBLIK yang dipanggil setelah pelanggan memindai QR.
 * Tidak butuh login, jadi tidak dipasang requireAuth.
 */
async function resolveToken(req, res) {
  const token = String(req.query.token || '').trim();
  if (!token) {
    throw ApiError.badRequest('Token QR wajib disertakan.');
  }

  const table = await tableService.resolveToken(token);
  if (!table) {
    throw ApiError.notFound(
      'QR meja tidak valid atau sudah dicabut. Silakan minta bantuan kasir.'
    );
  }

  return ok(res, {
    data: {
      table,
      // Diberikan ke frontend supaya bisa masuk ke room Socket.IO meja ini.
      qrToken: token,
    },
    message: `Meja ${table.code} terdeteksi.`,
  });
}

module.exports = {
  list,
  detail,
  create,
  update,
  remove,
  regenerateQr,
  listQr,
  resolveToken,
};