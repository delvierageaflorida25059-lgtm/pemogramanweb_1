'use strict';

const express = require('express');
const authController = require('../controllers/auth.controller');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../utils/validators');
const { authLimiter } = require('../middleware/rateLimit');

const router = express.Router();

/**
 * POST /api/auth/login
 * Dibatasi ketat untuk memperlambat serangan brute force password.
 */
router.post(
  '/login',
  authLimiter,
  validate({
    email: { type: 'email', required: true, label: 'Email' },
    password: { type: 'string', required: true, label: 'Password' },
  }),
  authController.login
);

/**
 * POST /api/auth/register
 */
router.post(
  '/register',
  authLimiter,
  validate({
    name: { type: 'string', required: true, min: 2, max: 100, label: 'Nama' },
    email: { type: 'email', required: true, label: 'Email' },
    phone: { type: 'string', max: 30, label: 'Nomor HP' },
    password: { type: 'password', required: true, label: 'Password' },
  }),
  authController.register
);

/**
 * POST /api/auth/refresh
 */
router.post(
  '/refresh',
  validate({
    refreshToken: { type: 'string', required: true, label: 'Refresh token' },
  }),
  authController.refresh
);

/**
 * POST /api/auth/logout
 */
router.post('/logout', requireAuth, authController.logout);

/** GET /api/auth/me */
router.get('/me', requireAuth, authController.me);

/**
 * PUT /api/auth/password
 */
router.put(
  '/password',
  requireAuth,
  validate({
    currentPassword: { type: 'string', required: true, label: 'Password saat ini' },
    newPassword: { type: 'password', required: true, label: 'Password baru' },
  }),
  authController.changePassword
);

module.exports = router;