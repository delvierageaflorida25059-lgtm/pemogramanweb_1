'use strict';

/**
 * Pembungkus respons HTTP agar bentuk JSON konsisten di seluruh API.
 *
 * Bentuk sukses : { success: true, message, data, meta? }
 * Bentuk gagal  : { success: false, message, code, errors? }
 */

/**
 * @param {import('express').Response} res
 * @param {object} options
 * @param {any}    [options.data]
 * @param {string} [options.message]
 * @param {object} [options.meta]  metadata paginasi dll
 * @param {number} [options.status=200]
 */
function ok(res, { data = null, message = 'Berhasil', meta = null, status = 200 } = {}) {
  const body = { success: true, message };
  if (meta) body.meta = meta;
  // Selalu sertakan data supaya bentuk JSON tidak berubah-ubah.
  body.data = data;
  return res.status(status).json(body);
}

/**
 * @param {import('express').Response} res
 * @param {import('express').Request} req
 * @param {object} options
 * @param {any}    [options.items]
 * @param {number} options.total     total baris di database
 * @param {number} [options.page=1]
 * @param {number} [options.limit=20]
 * @param {number} [options.pages]   total halaman (dihitung bila tidak diisi)
 */
function paginated(res, req, { items, total, page = 1, limit = 20, pages }) {
  const safeLimit = Math.max(1, Number(limit) || 20);
  const safePage = Math.max(1, Number(page) || 1);
  const totalPages = pages !== undefined ? pages : Math.ceil(total / safeLimit) || 1;

  return ok(res, {
    data: items,
    meta: {
      page: safePage,
      limit: safeLimit,
      total: Number(total) || 0,
      totalPages,
      hasNext: safePage < totalPages,
      hasPrev: safePage > 1,
    },
  });
}

/**
 * Ambil parameter paginasi dari query string dengan batas aman.
 * Mencegah request seperti ?limit=999999 membuat server kewalahan.
 *
 * @param {import('express').Request} req
 * @param {object} [defaults]
 * @returns {{page:number, limit:number, offset:number}}
 */
function getPagination(req, defaults = {}) {
  const maxLimit = 100;
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || defaults.page || 1);
  const requestedLimit = Number.parseInt(req.query.limit, 10) || defaults.limit || 20;
  const limit = Math.min(maxLimit, Math.max(1, requestedLimit));
  return { page, limit, offset: (page - 1) * limit };
}

module.exports = { ok, paginated, getPagination };