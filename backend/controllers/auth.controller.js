'use strict';

const authService = require('../services/auth.service');
const { ok } = require('../utils/response');
const { setAudit } = require('../middleware/audit');

/**
 * Controller autentikasi.
 *
 * Controller sengaja tipis: hanya membaca req, memanggil service, lalu
 * mengirim response. Semua logika bisnis ada di service.
 */

/**
 * POST /api/auth/login
 */
async function login(req, res) {
  const result = await authService.login(
    { email: req.body.email, password: req.body.password },
    req
  );

  setAudit(res, {
    action: 'LOGIN',
    entityType: 'user',
    entityId: result.user.id,
    description: `Login berhasil sebagai ${result.user.email}`,
  });

  return ok(res, {
    data: {
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
    },
    message: 'Login berhasil.',
  });
}

/**
 * POST /api/auth/register
 * Registrasi mandiri hanya membuat akun ber-role CUSTOMER.
 */
async function register(req, res) {
  const userId = await authService.registerCustomer(req.body);

  setAudit(res, {
    action: 'REGISTER',
    entityType: 'user',
    entityId: userId,
    description: `Registrasi akun baru: ${req.body.email}`,
  });

  return ok(res, {
    data: { id: Number(userId) },
    message: 'Registrasi berhasil. Silakan masuk.',
    status: 201,
  });
}

/**
 * POST /api/auth/refresh
 */
async function refresh(req, res) {
  const result = await authService.refresh(req.body.refreshToken, req);

  return ok(res, {
    data: {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      user: result.user,
    },
    message: 'Token berhasil diperbarui.',
  });
}

/**
 * POST /api/auth/logout
 * Menghapus refresh token milik user yang sedang login.
 */
async function logout(req, res) {
  const result = await authService.logout(req.user.id, req.body?.refreshToken || null);

  setAudit(res, {
    action: 'LOGOUT',
    entityType: 'user',
    entityId: req.user.id,
    description: `Logout (scope: ${result.scope})`,
    metadata: { scope: result.scope },
  });

  return ok(res, { data: result, message: 'Logout berhasil.' });
}

/**
 * GET /api/auth/me
 */
async function me(req, res) {
  const user = await authService.me(req.user.id);
  return ok(res, { data: user, message: 'Profil pengguna.' });
}

/**
 * PUT /api/auth/password
 */
async function changePassword(req, res) {
  const result = await authService.changePassword(
    req.user.id,
    req.body.currentPassword,
    req.body.newPassword
  );

  setAudit(res, {
    action: 'CHANGE_PASSWORD',
    entityType: 'user',
    entityId: req.user.id,
    description: 'User mengganti passwordnya sendiri',
  });

  return ok(res, { data: null, message: result.message });
}

module.exports = { login, register, refresh, logout, me, changePassword };