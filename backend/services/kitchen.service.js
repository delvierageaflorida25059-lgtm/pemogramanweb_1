'use strict';

const { query } = require('../config/database');
const orderService = require('./order.service');

/**
 * Service Kitchen Display System.
 *
 * Dapur butuh tampilan yang dikelompokkan per status, bukan daftar order
 * kronologis. Modul ini menyediakan data siap tampil untuk KDS.
 *
 * Semua perpindahan status TETAP memakai orderService.changeStatus supaya
 * aturan transisinya hanya ada di satu tempat.
 */

/** Urutan tampilan kartu di papan dapur. */
const BOARD_ORDER = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY'];

/** Label Bahasa Indonesia untuk tiap status. */
const STATUS_LABELS = {
  PENDING: 'Menunggu',
  CONFIRMED: 'Dikonfirmasi',
  PREPARING: 'Sedang Dimasak',
  READY: 'Siap Diantar',
  COMPLETED: 'Selesai',
  CANCELLED: 'Dibatalkan',
};

/** Urutan status berikutnya yang ditampilkan sebagai tombol aksi. */
const NEXT_ACTION = {
  PENDING: { to: 'CONFIRMED', label: 'Terima' },
  CONFIRMED: { to: 'PREPARING', label: 'Mulai Masak' },
  PREPARING: { to: 'READY', label: 'Siap Diantar' },
  READY: { to: 'COMPLETED', label: 'Selesai Diantar' },
};

/**
 * Papan dapur: order aktif dikelompokkan per status.
 *
 * @param {object} [filters]
 * @param {string[]} [filters.statuses]  default: BOARD_ORDER
 * @returns {Promise<object>}
 */
async function board(filters = {}) {
  const statuses = Array.isArray(filters.statuses) && filters.statuses.length > 0
    ? filters.statuses
    : BOARD_ORDER;

  const { rows } = await orderService.list({ status: statuses, limit: 100 });

  // Ambil seluruh item sekaligus supaya tidak ada query per kartu.
  const orders = rows.length > 0 ? await attachItems(rows) : [];

  const columns = {};
  for (const status of BOARD_ORDER) {
    columns[status] = { status, label: STATUS_LABELS[status], orders: [] };
  }

  for (const order of orders) {
    if (!columns[order.status]) {
      columns[order.status] = { status: order.status, label: STATUS_LABELS[order.status], orders: [] };
    }
    columns[order.status].orders.push(order);
  }

  // Kartu yang paling lama menunggu didahulukan supaya tidak tenggelam.
  for (const column of Object.values(columns)) {
    column.orders.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  return {
    columns,
    counts: Object.fromEntries(
      Object.entries(columns).map(([status, column]) => [status, column.orders.length])
    ),
    totalActive: orders.length,
  };
}

/**
 * @param {object[]} orders
 */
async function attachItems(orders) {
  const ids = orders.map((order) => order.id);
  if (ids.length === 0) return [];

  const [itemRows] = await query(
    `SELECT id, order_id, product_name, variant_name, quantity, note
       FROM order_items
      WHERE order_id IN (${ids.map(() => '?').join(',')})
      ORDER BY id ASC`,
    ids
  );

  const itemsByOrder = new Map();
  for (const row of itemRows) {
    if (!itemsByOrder.has(row.order_id)) itemsByOrder.set(row.order_id, []);
    itemsByOrder.get(row.order_id).push({
      name: row.product_name,
      variant: row.variant_name,
      quantity: Number(row.quantity),
      note: row.note,
    });
  }

  return orders.map((order) => ({
    ...order,
    kitchenItems: itemsByOrder.get(order.id) || [],
    nextAction: NEXT_ACTION[order.status] || null,
  }));
}

/**
 * Ubah status order dari papan dapur.
 *
 * @param {number} orderId
 * @param {string} nextStatus
 * @param {object|null} user
 * @param {string} [note]
 */
async function advance(orderId, nextStatus, user = null, note = null) {
  if (!Object.values(NEXT_ACTION).some((action) => action.to === nextStatus)) {
    const { ApiError } = require('../utils/ApiError');
    throw ApiError.badRequest(
      `Status "${nextStatus}" bukan tahap yang bisa dilakukan dapur.`
    );
  }
  return orderService.changeStatus(orderId, nextStatus, user, note);
}

/**
 * Ambil status berikutnya untuk sebuah order, dipakai tombol di UI.
 * @param {object} order
 */
function nextActionFor(order) {
  return NEXT_ACTION[order.status] || null;
}

module.exports = { board, advance, nextActionFor, BOARD_ORDER, STATUS_LABELS, NEXT_ACTION };
