'use strict';

const express = require('express');
const { wrapRouter } = require('../utils/asyncHandler');
const router = express.Router();

const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const menuRoutes = require('./menu.routes');
const categoryRoutes = require('./category.routes');
const productRoutes = require('./product.routes');
const tableRoutes = require('./table.routes');
const orderRoutes = require('./order.routes');
const paymentRoutes = require('./payment.routes');
const kitchenRoutes = require('./kitchen.routes');
const inventoryRoutes = require('./inventory.routes');
const miscRoutes = require('./misc.routes');

/**
 * Titik masuk seluruh API.
 *
 * Prefix `/api` sudah dipasang di app.js, jadi setiap route di bawah ditulis
 * relatif terhadap prefix tersebut.
 *
 * CATATAN PENTING
 * wrapRouter() harus dipanggil pada SETIAP sub-router SEBELUM di-mount.
 * Express tidak mewarisi stack handler dari router anak ke router induk,
 * jadi membungkus router utama saja tidak akan mengubah apa pun. Tanpa
 * langkah ini, setiap error dari controller async akan menggantung request.
 */

/** Bungkus sub-router lalu pasang ke path-nya. */
function mount(prefix, subRouter) {
  router.use(prefix, wrapRouter(subRouter));
}

mount('/auth', authRoutes);
mount('/users', userRoutes);

// Modul untuk halaman pelanggan (QR) tidak butuh login.
mount('/menu', menuRoutes);
mount('/tables', tableRoutes);

// Modul operasional butuh login; masing-masing route sudah memasang
// requirePermission yang sesuai.
mount('/categories', categoryRoutes);
mount('/products', productRoutes);
mount('/orders', orderRoutes);
mount('/payments', paymentRoutes);
mount('/kitchen', kitchenRoutes);

// Fase 4 - Inventory, Recipe/BOM, dan Stock Opname
mount('/inventory', inventoryRoutes);

// Notifikasi dan dashboard
mount('/notifications', miscRoutes);
mount('/dashboard', miscRoutes);

module.exports = router;