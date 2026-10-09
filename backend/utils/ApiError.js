'use strict';

/**
 * Error yang sudah "sengaja" terjadi di layer bisnis.
 * Error ini diteruskan ke client apa adanya lewat errorHandler terpusat.
 */
class ApiError extends Error {
  /**
   * @param {number} statusCode  HTTP status code
   * @param {string} message     pesan yang aman ditampilkan ke user
   * @param {object} [options]
   * @param {string} [options.code]     kode mesin, mis. "VALIDATION_ERROR"
   * @param {object} [options.details]  rincian error per field
   * @param {Error}  [options.cause]    error asli untuk keperluan log
   */
  constructor(statusCode, message, options = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = options.code || defaultCodeForStatus(statusCode);
    this.details = options.details;
    this.cause = options.cause;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = 'Permintaan tidak valid', options) {
    return new ApiError(400, message, options);
  }

  static unauthorized(message = 'Anda harus masuk terlebih dahulu', options) {
    return new ApiError(401, message, options);
  }

  static forbidden(message = 'Anda tidak memiliki izin untuk aksi ini', options) {
    return new ApiError(403, message, options);
  }

  static notFound(message = 'Data tidak ditemukan', options) {
    return new ApiError(404, message, options);
  }

  static conflict(message = 'Data sudah ada', options) {
    return new ApiError(409, message, options);
  }

  static unprocessable(message = 'Data tidak dapat diproses', options) {
    return new ApiError(422, message, options);
  }

  static internal(message = 'Terjadi kesalahan pada server', options) {
    return new ApiError(500, message, options);
  }
}

function defaultCodeForStatus(statusCode) {
  const map = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    422: 'UNPROCESSABLE_ENTITY',
    429: 'TOO_MANY_REQUESTS',
    500: 'INTERNAL_SERVER_ERROR',
  };
  return map[statusCode] || 'ERROR';
}

module.exports = ApiError;