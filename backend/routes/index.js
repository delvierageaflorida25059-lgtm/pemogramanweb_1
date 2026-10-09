'use strict';

const express = require('express');
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
const miscRoutes = require('./misc.routes');

/**
 * Titik masuk seluruh API.
 *
 * Prefix `/api` sudah dipasang di app.js, jadi setiap route di bawah ditulis
 * relatif terhadap prefix tersebut.
 */
router.use('/auth', authRoutes);
router.use('/users', userRoutes);

// Modul untuk halaman pelanggan (QR) tidak butuh login.
router.use('/menu', menuRoutes);
router.use('/tables', tableRoutes);

// Modul operasional butuh login; masing-masing route sudah memasang
// requirePermission yang sesuai.
router.use('/categories', categoryRoutes);
router.use('/products', productRoutes);
router.use('/orders', orderRoutes);
router.use('/payments', paymentRoutes);
router.use('/kitchen', kitchenRoutes);
router.use('/notifications', miscRoutes);
router.use('/dashboard', miscRoutes);

module.exports = router;