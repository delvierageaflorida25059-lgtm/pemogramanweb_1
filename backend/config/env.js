'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

/**
 * Konfigurasi aplikasi yang dibaca dari environment.
 * Semua secret hanya boleh ada di sini, tidak pernah ditulis literal di kode.
 */
function int(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function list(value, fallback = []) {
  if (!value) return fallback;
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

const jwtAccessSecret = process.env.JWT_ACCESS_SECRET || '';
const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || '';

// Alih-alih membuat server crash, secret default hanya dipakai di development
// supaya demo lokal tetap bisa jalan tanpa .env. Production menolak berjalan
// bila secret belum diisi dengan benar.
const DEV_FALLBACK_SECRET = 'dev-only-insecure-secret-do-not-use-in-production';

if (isProduction) {
  const missing = [];
  if (!jwtAccessSecret || jwtAccessSecret.length < 32) missing.push('JWT_ACCESS_SECRET (minimal 32 karakter)');
  if (!jwtRefreshSecret || jwtRefreshSecret.length < 32) missing.push('JWT_REFRESH_SECRET (minimal 32 karakter)');
  if (!process.env.DB_PASSWORD) {
    console.warn('[config] DB_PASSWORD kosong. Pastikan ini memang sesuai pada environment Anda.');
  }
  if (missing.length > 0) {
    throw new Error(`Konfigurasi production tidak valid: ${missing.join(', ')}`);
  }
}

const config = {
  nodeEnv,
  isProduction,
  port: int(process.env.PORT, 3000),
  appName: process.env.APP_NAME || 'Smart Restaurant Management',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/+$/, ''),

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: int(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD ?? '',
    name: process.env.DB_NAME || 'restaurant_management',
    connectionLimit: int(process.env.DB_CONNECTION_LIMIT, 10),
  },

  jwt: {
    accessSecret: jwtAccessSecret || DEV_FALLBACK_SECRET,
    refreshSecret: jwtRefreshSecret || `${DEV_FALLBACK_SECRET}-refresh`,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  security: {
    bcryptSaltRounds: int(process.env.BCRYPT_SALT_ROUNDS, 10),
    corsOrigin: list(process.env.CORS_ORIGIN, ['http://localhost:3000', 'http://127.0.0.1:3000']),
    rateLimitWindowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    rateLimitMax: int(process.env.RATE_LIMIT_MAX, 300),
    authRateLimitMax: int(process.env.AUTH_RATE_LIMIT_MAX, 10),
  },

  restaurant: {
    name: process.env.RESTAURANT_NAME || 'Restoran Nusantara',
    currency: process.env.RESTAURANT_CURRENCY || 'IDR',
    taxPercent: num(process.env.TAX_PERCENT, 10),
    serviceChargePercent: num(process.env.SERVICE_CHARGE_PERCENT, 5),
  },

  // -------------------------------------------------------------------------
  // Inventory (Fase 4)
  // -------------------------------------------------------------------------
  inventory: {
    /**
     * Saat stok bahan baku tidak cukup, apakah order tetap diproses?
     *
     * true  = stok boleh menjadi minus, notifikasi dikirim (pilihan aman untuk
     *         operasional karena order yang sudah dibayar tidak bisa ditolak)
     * false = order ditolak dengan pesan jelas (konservatif, tapi bisa membuat
     *         pelanggan yang sudah membayar tertahan)
     */
    allowNegativeStock: process.env.INVENTORY_ALLOW_NEGATIVE_STOCK !== 'false',

    /**
     * Mengubah products.stock_status menjadi UNAVAILABLE otomatis ketika stok
     * bahannya habis. Default false supaya tidak mengubah perilaku lama.
     */
    autoToggleProduct: process.env.INVENTORY_AUTO_TOGGLE_PRODUCT === 'true',

    // Ambang batas (%) di bawah minimum_stock yang memicu notifikasi.
    lowStockThresholdPercent: num(process.env.INVENTORY_LOW_STOCK_PERCENT, 100),
  },
};

module.exports = config;