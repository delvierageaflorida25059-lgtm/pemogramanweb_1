'use strict';

/**
 * Socket.IO untuk realtime.
 *
 * Modul ini menyimpan instance `io` di level aplikasi (bukan di level request)
 * agar service bisa memancarkan event tanpa harus menerima req/res.
 *
 * Ruang channel yang dipakai:
 *   - "kitchen"       papan Kitchen Display
 *   - "order:<id>"    status satu order (dipakai halaman lacak pesanan)
 *   - "table:<code>"  status meja tertentu
 *   - "dashboard"     ringkasan untuk owner/manager
 */

let io = null;

/** @param {import('socket.io').Server} instance */
function init(instance) {
  io = instance;
  return io;
}

function get() {
  return io;
}

/**
 * Pancarkan event ke sebuah room. diam-diam tidak doing anything bila
 * Socket.IO belum diinisialisasi (mis. saat running unit test).
 *
 * @param {string} room
 * @param {string} event
 * @param {any} payload
 */
function emitTo(room, event, payload) {
  if (!io) return;
  io.to(room).emit(event, payload);
}

/** Pancarkan ke semua pengguna yang sedang terhubung. */
function emitAll(event, payload) {
  if (!io) return;
  io.emit(event, payload);
}

const ROOMS = {
  kitchen: 'kitchen',
  dashboard: 'dashboard',
  order: (id) => `order:${id}`,
  table: (code) => `table:${code}`,
};

module.exports = { init, get, emitTo, emitAll, ROOMS };