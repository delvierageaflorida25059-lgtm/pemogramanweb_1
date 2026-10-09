'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');

const config = require('./config/env');
const apiRoutes = require('./routes');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimit');
const { auditMiddleware } = require('./middleware/audit');

/**
 * Konfigurasi aplikasi Express.
 *
 * Dipisah dari server.js supaya bisa di-import langsung oleh unit test
 * tanpa membuka port.
 *
 * @returns {import('express').Express}
 */
function createApp() {
  const app = express();

  // Di belakang reverse proxy (Nginx), req.ip harus diambil dari header
  // X-Forwarded-For supaya rate limit dan audit log mencatat IP asli.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // ---------------------------------------------------------------------
  // Keamanan dasar
  // ---------------------------------------------------------------------

  app.use(
    cors({
      origin(origin, callback) {
        // Permintaan tanpa Origin (curl, aplikasi seluler, file lokal) diizinkan.
        if (!origin) return callback(null, true);
        if (config.security.corsOrigin.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} tidak diizinkan oleh CORS.`));
      },
      credentials: true,
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Header keamanan dasar. Dalam development, CSP sengaja longgar supaya
  // halaman tetap bisa dimuat tanpa blocked resource.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-XSS-Protection', '0');
    next();
  });

  // ---------------------------------------------------------------------
  // Health check
  // ---------------------------------------------------------------------

  app.get('/health', async (_req, res) => {
    try {
      // Sengaja tidak query database di sini supaya endpoint selalu murah.
      res.json({
        success: true,
        message: 'Server berjalan.',
        data: {
          app: config.appName,
          environment: config.nodeEnv,
          uptimeSeconds: Math.round(process.uptime()),
        },
      });
    } catch (error) {
      res.status(503).json({ success: false, message: 'Server tidak sehat.' });
    }
  });

  // ---------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------

  app.use('/api', apiLimiter, auditMiddleware, apiRoutes);

  // Endpoint yang tidak dikenal di bawah /api harus dibalas JSON 404,
  // bukan halaman HTML Express.
  app.use('/api', notFoundHandler);

  // ---------------------------------------------------------------------
  // Frontend statis
  // ---------------------------------------------------------------------

  const frontendDir = path.resolve(__dirname, '../frontend');
  app.use(express.static(frontendDir, { extensions: ['html'] }));

  // ---------------------------------------------------------------------
  // Error handling - HARUS paling akhir
  // ---------------------------------------------------------------------

  app.use(errorHandler);

  return app;
}

module.exports = { createApp };