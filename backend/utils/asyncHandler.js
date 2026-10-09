'use strict';

/**
 * Pembungkus handler async untuk Express 4.
 *
 * MASALAH YANG DISOLUSIKAN
 * Express 4 tidak menangkap Promise rejection. Handler yang ditandai `async`
 * dan melempar error akan menghasilkan "Unhandled promise rejection" dan TIDAK
 * PERNAH mengirim response - request menggantung selamanya sampai client
 * kehabisan waktu.
 *
 * Express 5 sudah memperbaikinya secara bawaan, namun proyek ini memakai
 * Express 4 (stabil dan sudah umum dipakai). Karena itu setiap handler
 * dibungkus oleh fungsi di bawah supaya error diteruskan ke next(error) dan
 * akhirnya ditangani oleh errorHandler terpusat.
 */

/**
 * Membungkus satu handler async.
 * @param {Function} handler
 * @returns {import('express').RequestHandler}
 */
function asyncHandler(handler) {
  return function wrappedAsyncHandler(req, res, next) {
    try {
      // Promise.resolve menutup kemungkinan handler melempar error secara
      // sinkron sebelum sempat mengembalikan Promise.
      Promise.resolve(handler(req, res, next)).catch(next);
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Membungkus seluruh handler yang sudah terdaftar pada sebuah router.
 *
 * Dipanggil sekali setelah semua route didefinisikan, sehingga tidak perlu
 * menulis asyncHandler(...) di setiap route secara manual.
 *
 * @param {import('express').Router} router
 * @returns {import('express').Router} router yang sama
 */
function wrapRouter(router) {
  for (const layer of router.stack) {
    // Lapisan route (router.get/post/...) menyimpan handler di route.stack.
    if (layer.route) {
      for (const routeLayer of layer.route.stack) {
        routeLayer.handle = asyncHandler(routeLayer.handle);
      }
      continue;
    }

    // Lapisan middleware yang dipasang lewat router.use(...).
    if (typeof layer.handle === 'function') {
      layer.handle = asyncHandler(layer.handle);
    }
  }

  return router;
}

module.exports = { asyncHandler, wrapRouter };