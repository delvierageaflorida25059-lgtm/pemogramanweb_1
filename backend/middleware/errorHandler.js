'use strict';

const ApiError = require('../utils/ApiError');
const config = require('../config/env');

/**
 * Error handler terpusat.
 *
 * Aturan:
 *   - ApiError         -> dikembalikan apa adanya (aman untuk user)
 *   - error dari MySQL  -> dipetakan ke pesan yang masuk akal
 *   - error lain       -> 500 dengan pesan generik, detail asli hanya di log
 *
 * Harus dipasang sebagai middleware terakhir.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(error, req, res, _next) {
  let statusCode = error.statusCode || 500;
  let message = error.message || 'Terjadi kesalahan pada server.';
  let code = error.code || 'INTERNAL_SERVER_ERROR';
  let details = error.details;

  // Kolom duplikat (kode produk, email, kode meja yang sudah dipakai)
  if (error.code === 'ER_DUP_ENTRY') {
    statusCode = 409;
    code = 'DUPLICATE_VALUE';
    message = 'Data sudah ada. Periksa kembali kolom yang wajib unik.';
  }

  // Nilai di luar rentang kolom (mis. varchar terlalu panjang, angka negatif)
  if (error.code === 'ER_DATA_OUT_OF_RANGE') {
    statusCode = 400;
    code = 'OUT_OF_RANGE';
    message = 'Nilai yang dikirim di luar rentang yang diperbolehkan.';
  }

  // Kunci asing / relasi tidak ditemukan
  if (error.code === 'ER_NO_REFERENCED_ROW_2' || error.code === 'ER_ROW_IS_REFERENCED_2') {
    statusCode = 400;
    code = 'REFERENCE_ERROR';
    message = error.code === 'ER_NO_REFERENCED_ROW_2'
      ? 'Data yang dirujuk tidak ditemukan.'
      : 'Data masih dipakai oleh data lain sehingga tidak bisa dihapus.';
  }

  // Koneksi database terputus
  if (error.code === 'PROTOCOL_CONNECTION_LOST' || error.code === 'ECONNREFUSED') {
    statusCode = 503;
    code = 'DATABASE_UNAVAILABLE';
    message = 'Database sedang tidak tersedia. Coba lagi sebentar lagi.';
  }

  // Hanya error tak terduga yang membocorkan apa pun ke log.
  if (statusCode >= 500) {
    console.error('[ERROR]', {
      method: req.method,
      url: req.originalUrl,
      message: error.message,
      code: error.code,
      stack: error.stack,
      cause: error.cause?.message,
    });
  }

  const body = {
    success: false,
    message,
    code,
  };
  if (details) body.errors = details;

  // Di development, sertakan stack trace supaya mudah debug.
  if (config.nodeEnv === 'development' && statusCode >= 500) {
    body.stack = error.stack;
  }

  res.status(statusCode).json(body);
}

/** Handler untuk request yang tidak cocok dengan route mana pun. */
function notFoundHandler(req, _res, next) {
  next(ApiError.notFound(`Endpoint ${req.method} ${req.originalUrl} tidak ditemukan.`));
}

module.exports = { errorHandler, notFoundHandler };