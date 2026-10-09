'use strict';

/**
 * Utilitas token JWT.
 *
 * Dipisahkan dari middleware supaya service bisa memakainya tanpa menarik
 * middleware Express.
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config/env');
const ApiError = require('./ApiError');

/**
 * @param {{id:number, email:string, name:string, roles:string[], permissions:string[]}} user
 * @returns {{accessToken:string, expiresIn:string}}
 */
function signAccessToken(user) {
  const payload = {
    sub: String(user.id),
    email: user.email,
    name: user.name,
    roles: user.roles,
    permissions: user.permissions,
    type: 'access',
  };
  return {
    accessToken: jwt.sign(payload, config.jwt.accessSecret, {
      expiresIn: config.jwt.accessExpiresIn,
    }),
    expiresIn: config.jwt.accessExpiresIn,
  };
}

/**
 * Refresh token.
 *
 * Field `jti` (JWT ID) WAJIB diacak. Tanpa itu, dua login dalam detik yang
 * sama menghasilkan token yang identik piksel demi piksel (payload, iat, dan
 * exp sama), sehingga hash-nya bentrok di kolom UNIQUE refresh_tokens.
 *
 * @returns {string}
 */
function signRefreshToken(userId) {
  return jwt.sign(
    { sub: String(userId), type: 'refresh', jti: crypto.randomUUID() },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiresIn }
  );
}

/**
 * Refresh token disimpan di database dalam bentuk hash SHA-256, bukan mentah.
 * Kalau database bocor, token yang berhasil dicuri tidak langsung bisa dipakai
 * karena yang tersimpan hanya sidik digitalnya.
 *
 * @param {string} token
 * @returns {string} hex 64 karakter
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Verifikasi access token.
 * @param {string} token
 * @returns {object} payload JWT
 */
function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, config.jwt.accessSecret);
    if (payload.type !== 'access') {
      throw ApiError.unauthorized('Token tidak valid untuk akses ini.');
    }
    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.name === 'TokenExpiredError') {
      throw ApiError.unauthorized('Sesi Anda telah berakhir. Silakan masuk kembali.', {
        code: 'TOKEN_EXPIRED',
      });
    }
    throw ApiError.unauthorized('Token tidak valid.');
  }
}

/**
 * Verifikasi refresh token.
 * @param {string} token
 * @returns {object} payload JWT
 */
function verifyRefreshToken(token) {
  try {
    const payload = jwt.verify(token, config.jwt.refreshSecret);
    if (payload.type !== 'refresh') {
      throw ApiError.unauthorized('Token tidak valid untuk refresh.');
    }
    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.name === 'TokenExpiredError') {
      throw ApiError.unauthorized('Refresh token sudah kedaluwarsa. Silakan masuk kembali.', {
        code: 'REFRESH_EXPIRED',
      });
    }
    throw ApiError.unauthorized('Refresh token tidak valid.');
  }
}

/**
 * Ambil Bearer token dari header Authorization.
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function extractBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header || typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  if (!token || scheme.toLowerCase() !== 'bearer') return null;
  return token.trim() || null;
}

/** Ubah payload JWT menjadi bentuk yang dipakai seluruh aplikasi. */
function toAuthUser(payload) {
  return {
    id: Number(payload.sub),
    email: payload.email,
    name: payload.name,
    roles: payload.roles || [],
    permissions: payload.permissions || [],
  };
}

/**
 * @param {string} expiresIn  contoh "7d" atau "15m"
 * @returns {Date} waktu kedaluwarsa absolut
 */
function expiryDateFromNow(expiresIn) {
  const match = /^(\d+)([smhd])$/.exec(String(expiresIn));
  if (!match) {
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }
  const value = Number(match[1]);
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]];
  return new Date(Date.now() + value * unitMs);
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashToken,
  extractBearerToken,
  toAuthUser,
  expiryDateFromNow,
};