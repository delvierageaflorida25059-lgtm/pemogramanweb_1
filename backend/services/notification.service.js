'use strict';

const { query } = require('../config/database');
const socket = require('../config/socket');

/**
 * Service notifikasi.
 *
 * Notifikasi disimpan ke tabel `notifications` supaya bisa dibaca ulang,
 * sekaligus dipancarkan lewat Socket.IO supaya Staff tidak perlu refresh.
 *
 * Notifikasi bersifat best-effort: kegagalan menulis notifikasi tidak boleh
 * menggagalkan aksi bisnis utamanya.
 */

/**
 * @param {object} entry
 * @param {number|null} [entry.userId]   null = broadcast
 * @param {number|null} [entry.orderId]
 * @param {string} [entry.type]          INFO | ORDER | PAYMENT | STOCK | SYSTEM
 * @param {string} entry.title
 * @param {string} entry.message
 */
async function create(entry) {
  try {
    const [result] = await query(
      `INSERT INTO notifications (user_id, order_id, type, title, message)
       VALUES (?, ?, ?, ?, ?)`,
      [
        entry.userId ?? null,
        entry.orderId ?? null,
        entry.type || 'INFO',
        String(entry.title).slice(0, 150),
        String(entry.message).slice(0, 500),
      ]
    );

    const payload = {
      id: Number(result.insertId),
      type: entry.type || 'INFO',
      title: entry.title,
      message: entry.message,
      orderId: entry.orderId ?? null,
      createdAt: new Date().toISOString(),
    };

    // Broadcast ke semua koneksi; masing-masing client yang menyaring sesuai
    // userId-nya sendiri.
    socket.emitAll('notification:new', payload);
    return payload;
  } catch (error) {
    console.error('[notification] gagal menyimpan:', error.message);
    return null;
  }
}

/**
 * Notifikasi order baru untuk dapur.
 * @param {object} order
 */
async function notifyOrderCreated(order) {
  const itemSummary = order.items
    ? order.items.map((item) => `${item.quantity}x ${item.productName}`).join(', ')
    : '';

  return create({
    type: 'ORDER',
    orderId: order.id,
    title: `Order baru ${order.orderNumber}`,
    message: `${order.tableCode ? `Meja ${order.tableCode}` : 'Tanpa meja'} - ${order.source}: ${itemSummary}`,
  });
}

/**
 * Notifikasi status order untuk pelanggan yang memindai QR.
 * Halaman lacak pesanan sudah listens ke room "order:<id>", jadi pesan ini
 * cukup sampai ke sana.
 *
 * @param {object} order
 */
async function notifyOrderStatus(order) {
  const labels = {
    PENDING: 'Menunggu konfirmasi',
    CONFIRMED: 'Pesanan dikonfirmasi dapur',
    PREPARING: 'Sedang dimasak',
    READY: 'Pesanan siap diantar',
    COMPLETED: 'Pesanan selesai',
    CANCELLED: 'Pesanan dibatalkan',
  };

  return create({
    type: 'ORDER',
    orderId: order.id,
    title: `Status ${order.orderNumber}: ${labels[order.status] || order.status}`,
    message: `Meja ${order.tableCode || '-'} - total ${money(order.total)}`,
  });
}

/**
 * @param {number|null} userId  null = semua notifikasi broadcast
 * @param {object} [filters]
 */
async function list(userId, filters = {}) {
  const conditions = [];
  const params = [];

  if (userId) {
    conditions.push('(n.user_id = ? OR n.user_id IS NULL)');
    params.push(userId);
  }
  if (filters.unreadOnly) conditions.push('n.is_read = 0');
  if (filters.orderId) { conditions.push('n.order_id = ?'); params.push(filters.orderId); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await query(
    `SELECT n.id, n.user_id, n.order_id, n.type, n.title, n.message, n.is_read, n.created_at
       FROM notifications n
       ${where}
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT ? OFFSET ?`,
    [...params, filters.limit ?? 30, filters.offset ?? 0]
  );

  const [countRows] = await query(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN n.is_read = 0 THEN 1 ELSE 0 END) AS unread
       FROM notifications n
       ${where}`,
    params
  );

  return {
    rows: rows.map((row) => ({
      id: Number(row.id),
      userId: row.user_id ? Number(row.user_id) : null,
      orderId: row.order_id ? Number(row.order_id) : null,
      type: row.type,
      title: row.title,
      message: row.message,
      isRead: Boolean(row.is_read),
      createdAt: row.created_at,
    })),
    total: Number(countRows[0].total),
    unread: Number(countRows[0].unread || 0),
  };
}

/**
 * Tandai sudah dibaca.
 * @param {number} notificationId
 * @param {number|null} userId  null = tandai semua milik user
 */
async function markRead(notificationId, userId = null) {
  if (notificationId) {
    await query(`UPDATE notifications SET is_read = 1 WHERE id = ?`, [notificationId]);
    return { id: Number(notificationId), isRead: true };
  }

  if (userId) {
    await query(`UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0`, [userId]);
  }
  return { all: true };
}

/** @param {number} userId */
async function countUnread(userId) {
  const [rows] = await query(
    `SELECT COUNT(*) AS total
       FROM notifications
      WHERE is_read = 0 AND (user_id = ? OR user_id IS NULL)`,
    [userId]
  );
  return Number(rows[0].total);
}

/** Format angka ringkas untuk pesan notifikasi. */
function money(value) {
  return `Rp ${Math.round(Number(value) || 0).toLocaleString('id-ID')}`;
}

module.exports = {
  create,
  list,
  markRead,
  countUnread,
  notifyOrderCreated,
  notifyOrderStatus,
};