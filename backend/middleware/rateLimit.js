'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config/env');

/** Pesan yang sama untuk semua jenis rate limit, supaya konsisten. */
const MESSAGE = 'Terlalu banyak permintaan. Silakan coba lagi beberapa saat lagi.';

const handler = (_req, res) => {
  res.status(429).json({
    success: false,
    message: MESSAGE,
    code: 'TOO_MANY_REQUESTS',
  });
};

/** Rate limit global untuk seluruh /api. */
const apiLimiter = rateLimit({
  windowMs: config.security.rateLimitWindowMs,
  max: config.security.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
  // Endpoint health check tidak ikut dihitung.
  skip: (req) => req.path === '/health',
});

/**
 * Rate limit ketat untuk endpoint autentikasi.
 * Mencegah penyerang menebak password dengan brute force.
 */
const authLimiter = rateLimit({
  windowMs: config.security.rateLimitWindowMs,
  max: config.security.authRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
  skipSuccessfulRequests: true,
  message: { success: false, message: MESSAGE, code: 'TOO_MANY_REQUESTS' },
});

module.exports = { apiLimiter, authLimiter, MESSAGE };