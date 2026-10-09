'use strict';

const bcrypt = require('bcryptjs');
const { query, withTransaction } = require('../config/database');
const ApiError = require('../utils/ApiError');
const config = require('../config/env');
const token = require('../utils/token');
const userService = require('./user.service');

/**
 * Service autentikasi: login, refresh, logout, ganti password, registrasi.
 *
 * Catatan keamanan:
 *   - pesan error sengaja tidak membedakan "email tidak ada" vs "password
 *     salah" supaya penyerang tidak bisa memetakan user yang terdaftar
 *   - password dibandingkan dengan bcrypt.compare, bukan string ==
 *   - refresh token disimpan sebagai SHA-256 hash dan bisa dicabut
 */

const GENERIC_LOGIN_ERROR = 'Email atau password salah.';

/**
 * Hash bcrypt yang valid untuk sebuah password asal.
 *
 * Dipakai ketika email tidak ditemukan. Tanpa ini, jalur "email tidak ada"
 * akan selesai jauh lebih cepat daripada jalur "password salah", sehingga
 * penyerang bisa memetakan email mana yang terdaftar.
 */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('__timing_equaliser__', 10);

/**
 * @param {object} data
 * @param {string} data.email
 * @param {string} data.password
 * @param {import('express').Request} [req]
 * @returns {Promise<{user:object, accessToken:string, refreshToken:string, expiresIn:string}>}
 */
async function login(data, req = {}) {
  const email = String(data.email || '').trim().toLowerCase();
  const record = await userService.findByEmailWithPassword(email);

  if (!record) {
    // Tetap habiskan waktu dengan satu bcrypt.compare terhadap hash palsu.
    await bcrypt.compare(data.password || '', DUMMY_PASSWORD_HASH);
    throw ApiError.unauthorized(GENERIC_LOGIN_ERROR, { code: 'INVALID_CREDENTIALS' });
  }

  const passwordMatches = await bcrypt.compare(data.password, record.password_hash);
  if (!passwordMatches) {
    throw ApiError.unauthorized(GENERIC_LOGIN_ERROR, { code: 'INVALID_CREDENTIALS' });
  }

  if (record.status !== 'ACTIVE') {
    throw ApiError.forbidden('Akun Anda sedang dinonaktifkan. Hubungi administrator.');
  }

  const user = await userService.findAuthUserById(record.id);
  const { accessToken, expiresIn } = token.signAccessToken(user);
  const refreshToken = token.signRefreshToken(user.id);

  await query(`UPDATE users SET last_login_at = NOW() WHERE id = ?`, [user.id]);

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?)`,
    [
      user.id,
      token.hashToken(refreshToken),
      token.expiryDateFromNow(config.jwt.refreshExpiresIn),
      req.ip || null,
      req.get?.('user-agent')?.slice(0, 255) ?? null,
    ]
  );

  // Bersihkan token yang sudah kedaluwarsa agar tabel tidak menumpuk.
  await query(`DELETE FROM refresh_tokens WHERE expires_at < NOW()`);

  return { user, accessToken, refreshToken, expiresIn };
}

/**
 * Tukar refresh token yang masih valid dengan access token baru.
 *
 * @param {string} refreshToken
 * @param {import('express').Request} [req]
 */
async function refresh(refreshToken, req = {}) {
  const payload = token.verifyRefreshToken(refreshToken);
  const tokenHash = token.hashToken(refreshToken);

  const [rows] = await query(
    `SELECT id, user_id, expires_at, revoked_at
       FROM refresh_tokens
      WHERE token_hash = ?
      LIMIT 1`,
    [tokenHash]
  );

  // Token tidak ada, sudah dicabut, atau kedaluwarsa => sama-sama ditolak.
  if (rows.length === 0 || rows[0].revoked_at !== null || new Date(rows[0].expires_at) < new Date()) {
    throw ApiError.unauthorized('Refresh token tidak valid atau sudah kedaluwarsa.');
  }

  const user = await userService.findAuthUserById(payload.sub);
  if (!user || user.status !== 'ACTIVE') {
    throw ApiError.unauthorized('User tidak lagi aktif.');
  }

  // Rotasi refresh token: token lama langsung dicabut supaya hanya sekali pakai.
  const newRefreshToken = token.signRefreshToken(user.id);
  await withTransaction(async (conn) => {
    await conn.execute(
      `UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = ?`,
      [rows[0].id]
    );
    await conn.execute(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?)`,
      [
        user.id,
        token.hashToken(newRefreshToken),
        token.expiryDateFromNow(config.jwt.refreshExpiresIn),
        req.ip || null,
        req.get?.('user-agent')?.slice(0, 255) ?? null,
      ]
    );
  });

  const { accessToken, expiresIn } = token.signAccessToken(user);
  return { user, accessToken, refreshToken: newRefreshToken, expiresIn };
}

/**
 * Cabut refresh token milik pengguna.
 * @param {number} userId
 * @param {string|null} specificToken  token spesifik, atau null untuk logout semua perangkat
 */
async function logout(userId, specificToken) {
  if (specificToken) {
    await query(
      `UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND token_hash = ?`,
      [userId, token.hashToken(specificToken)]
    );
    return { scope: 'device' };
  }

  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL`,
    [userId]
  );
  return { scope: 'all-devices' };
}

/**
 * Ganti password user yang sedang login.
 * @param {number} userId
 * @param {string} currentPassword
 * @param {string} newPassword
 */
async function changePassword(userId, currentPassword, newPassword) {
  const [rows] = await query(
    `SELECT id, email, password_hash, status FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  if (rows.length === 0) throw ApiError.notFound('User tidak ditemukan.');

  const matches = await bcrypt.compare(currentPassword, rows[0].password_hash);
  if (!matches) {
    throw ApiError.badRequest('Password saat ini salah.', { code: 'WRONG_PASSWORD' });
  }
  if (currentPassword === newPassword) {
    throw ApiError.badRequest('Password baru harus berbeda dari password lama.');
  }

  await userService.setPassword(userId, newPassword);
  return { message: 'Password berhasil diubah. Silakan masuk kembali.' };
}

/**
 * Registrasi mandiri untuk role CUSTOMER.
 * Akun staff tetap hanya bisa dibuat oleh admin lewat modul user.
 *
 * @param {object} data
 */
async function registerCustomer(data) {
  const email = String(data.email).trim().toLowerCase();

  const [existing] = await query(`SELECT id FROM users WHERE email = ? LIMIT 1`, [email]);
  if (existing.length > 0) {
    throw ApiError.conflict('Email sudah terdaftar. Silakan masuk.');
  }

  const [roleRows] = await query(`SELECT id FROM roles WHERE name = 'CUSTOMER' LIMIT 1`);
  if (roleRows.length === 0) {
    throw ApiError.internal('Role CUSTOMER belum disiapkan. Jalankan npm run seed.');
  }

  const passwordHash = await bcrypt.hash(data.password, config.security.bcryptSaltRounds);

  return withTransaction(async (conn) => {
    const [result] = await conn.execute(
      `INSERT INTO users (name, email, phone, password_hash, status)
       VALUES (?, ?, ?, ?, 'ACTIVE')`,
      [data.name, email, data.phone ?? null, passwordHash]
    );
    await conn.execute(
      `INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`,
      [result.insertId, roleRows[0].id]
    );
    return result.insertId;
  });
}

/**
 * Profil user yang sedang login.
 * @param {number} userId
 */
async function me(userId) {
  const user = await userService.findAuthUserById(userId);
  if (!user) throw ApiError.notFound('User tidak ditemukan.');
  return user;
}

module.exports = { login, refresh, logout, changePassword, registerCustomer, me };
