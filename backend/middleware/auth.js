'use strict';

const ApiError = require('../utils/ApiError');
const token = require('../utils/token');
const userService = require('../services/user.service');

/**
 * Wajibkan request membawa access token yang valid.
 * Hasilnya disimpan di `req.user`.
 */
async function requireAuth(req, _res, next) {
  try {
    const raw = token.extractBearerToken(req);
    if (!raw) {
      throw ApiError.unauthorized('Token tidak ditemukan. Silakan masuk terlebih dahulu.');
    }

    const payload = token.verifyAccessToken(raw);

    // Selalu baca user terbaru dari database agar pemotongan izin langsung
    // berlaku walaupun access token lama masih valid.
    const user = await userService.findAuthUserById(payload.sub);
    if (!user) {
      throw ApiError.unauthorized('User tidak ditemukan atau sudah dihapus.');
    }
    if (user.status !== 'ACTIVE') {
      throw ApiError.forbidden('Akun Anda sedang dinonaktifkan. Hubungi administrator.');
    }

    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
}

/**
 * Set middleware ini SEBELUM requireAuth.
 * Endpoint publik seperti halaman menu hanya butuh knowing bila pengunjung
 * sudah login atau tidak, tanpa memaksa login.
 */
function optionalAuth(req, _res, next) {
  const raw = token.extractBearerToken(req);
  if (!raw) {
    req.user = null;
    return next();
  }
  try {
    const payload = token.verifyAccessToken(raw);
    req.user = token.toAuthUser(payload);
  } catch {
    req.user = null;
  }
  return next();
}

module.exports = { requireAuth, optionalAuth };