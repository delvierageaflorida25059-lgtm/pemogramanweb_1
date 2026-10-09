'use strict';

const { query, withTransaction } = require('../config/database');
const ApiError = require('../utils/ApiError');
const money = require('../utils/money');
const orderService = require('./order.service');
const socket = require('../config/socket');
const notificationService = require('./notification.service');

/**
 * Service pembayaran (SIMULASI - Fase 1-3).
 *
 * Modul ini SENGAJA tidak memanggil payment gateway. Yang dilakukan adalah
 * mencatat metode pembayaran beserta nominalnya dan memvalidasi bahwa uang
 * yang masuk cukup untuk menutup tagihan.
 *
 * Yang sudah disiapkan agar integrasi gateway nyata nanti tidak mengubah
 * bentuk data:
 *   - kolom `reference` untuk menyimpan id transaksi dari provider
 *   - `status` PENDING sehingga alur "create -> webhook konfirmasi" muat
 *   - nominal dan status tersimpan per baris, bukan overwrite satu field
 *
 * Yang belum ada dan harus ditambahkan saat integrasi:
 *   - verifikasi signature webhook provider
 *   - idempotency key agar webhook yang sama tidak dikreditkan dua kali
 */

const METHODS = ['CASH', 'TRANSFER', 'QRIS', 'CARD'];
const METHODS_WITHOUT_CHANGE = ['TRANSFER', 'QRIS', 'CARD'];

/**
 * @param {object} payload
 * @param {number} payload.order_id
 * @param {string} payload.method
 * @param {number} [payload.amount]  default: sisa tagihan yang belum dibayar
 * @param {number} [payload.tender]  uang yang diserahkan (khusus CASH)
 * @param {string} [payload.reference]
 * @param {string} [payload.note]
 * @param {object|null} user
 */
async function create(payload, user = null) {
  if (!METHODS.includes(payload.method)) {
    throw ApiError.badRequest(
      `Metode pembayaran harus salah satu dari: ${METHODS.join(', ')}.`
    );
  }

  const orderId = Number(payload.order_id);
  const result = await withTransaction(async (conn) => {
    // Lock baris order supaya dua kasir tidak bisa membayar order yang sama
    // secara bersamaan dan menyebabkan dobel kredit.
    const [orderRows] = await conn.execute(
      `SELECT id, order_number, status, total, paid_amount, source, table_id
         FROM orders
        WHERE id = ?
        FOR UPDATE`,
      [orderId]
    );

    if (orderRows.length === 0) throw ApiError.notFound('Order tidak ditemukan.');

    const order = orderRows[0];

    if (order.status === 'CANCELLED') {
      throw ApiError.conflict('Order yang sudah dibatalkan tidak bisa dibayar.');
    }

    const total = money.round(order.total);
    const alreadyPaid = money.round(order.paid_amount);
    const remaining = money.round(total - alreadyPaid);

    if (remaining <= 0) {
      throw ApiError.conflict('Order ini sudah lunas.');
    }

    const amount = money.round(payload.amount ?? remaining);
    if (amount <= 0) {
      throw ApiError.badRequest('Nominal pembayaran harus lebih besar dari nol.');
    }
    if (amount > remaining) {
      throw ApiError.badRequest(
        `Nominal pembayaran melebihi sisa tagihan. Sisa tagihan: ${money.formatRupiah(remaining)}.`
      );
    }

    let changeAmount = 0;
    if (payload.method === 'CASH') {
      const tender = money.round(payload.tender ?? amount);
      if (tender < amount) {
        throw ApiError.badRequest(
          `Uang yang diterima (${money.formatRupiah(tender)}) lebih sedikit dari nominal pembayaran (${money.formatRupiah(amount)}).`
        );
      }
      changeAmount = money.round(tender - amount);
    } else if (payload.tender !== undefined && payload.tender !== null && payload.tender !== '') {
      // Untuk metode non-tunai, kembalian tidak mungkin terjadi.
      throw ApiError.badRequest('Kembalian hanya berlaku untuk metode pembayaran CASH.');
    }

    // Metode non-tunai dicatat sebagai SUCCESS langsung karena Fase 1-3 tidak
    // punya proses verifikasi provider. Nanti tinggal diubah menjadi PENDING
    // lalu diaktifkan lewat webhook.
    const [insertResult] = await conn.execute(
      `INSERT INTO payments
         (order_id, method, amount, change_amount, status, reference, paid_by, note)
       VALUES (?, ?, ?, ?, 'SUCCESS', ?, ?, ?)`,
      [
        orderId,
        payload.method,
        amount,
        changeAmount,
        payload.reference ?? null,
        user ? user.id : null,
        payload.note ?? null,
      ]
    );

    const newPaidAmount = money.round(alreadyPaid + amount);
    await conn.execute(`UPDATE orders SET paid_amount = ? WHERE id = ?`, [newPaidAmount, orderId]);

    // Order yang dibayar lunas otomatis masuk ke tahap CONFIRMED supaya
    // kitchen langsung tahu order ini sah.
    let nextStatus = null;
    if (newPaidAmount >= total && order.status === 'PENDING') {
      nextStatus = 'CONFIRMED';
      await conn.execute(`UPDATE orders SET status = 'CONFIRMED' WHERE id = ?`, [orderId]);
      await conn.execute(
        `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note)
         VALUES (?, 'PENDING', 'CONFIRMED', ?, 'Otomatis setelah pembayaran lunas')`,
        [orderId, user ? user.id : null]
      );
    }

    return {
      paymentId: insertResult.insertId,
      orderId,
      orderNumber: order.order_number,
      amount,
      changeAmount,
      newPaidAmount,
      remaining: money.round(total - newPaidAmount),
      total,
      isFullyPaid: newPaidAmount >= total,
      nextStatus,
    };
  });

  const order = await orderService.findById(orderId);

  await notificationService.create({
    type: 'PAYMENT',
    orderId,
    title: `Pembayaran ${order.orderNumber}`,
    message: `${payload.method} ${money.formatRupiah(result.amount)} - ${
      result.isFullyPaid ? 'lunas' : `sisa ${money.formatRupiah(result.remaining)}`
    }`,
  });

  socket.emitTo(socket.ROOMS.kitchen, 'order:updated', order);
  socket.emitTo(socket.ROOMS.order(orderId), 'payment:success', {
    orderId,
    paymentId: result.paymentId,
    status: order.status,
    paidAmount: order.paidAmount,
    balanceDue: order.balanceDue,
  });
  socket.emitTo(socket.ROOMS.dashboard, 'payment:created', {
    orderNumber: order.orderNumber,
    amount: result.amount,
    method: payload.method,
  });

  return { ...result, payment: await findById(result.paymentId), order };
}

/**
 * @param {number} paymentId
 */
async function findById(paymentId) {
  const [rows] = await query(
    `SELECT id, order_id, method, amount, change_amount, status, refunded_amount,
            reference, note, paid_at, paid_by
       FROM payments
      WHERE id = ?
      LIMIT 1`,
    [Number(paymentId)]
  );
  return rows.length ? decoratePayment(rows[0]) : null;
}

/**
 * Daftar pembayaran dengan filter (dipakai halaman laporan kasir).
 * @param {object} filters
 */
async function list(filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.orderId) { conditions.push('p.order_id = ?'); params.push(filters.orderId); }
  if (filters.method) { conditions.push('p.method = ?'); params.push(filters.method); }
  if (filters.status) { conditions.push('p.status = ?'); params.push(filters.status); }
  if (filters.from) { conditions.push('p.paid_at >= ?'); params.push(filters.from); }
  if (filters.to) { conditions.push('p.paid_at <= ?'); params.push(filters.to); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await query(
    `SELECT p.id, p.order_id, p.method, p.amount, p.change_amount, p.status,
            p.refunded_amount, p.reference, p.note, p.paid_at, p.paid_by,
            o.order_number, o.source, t.code AS table_code
       FROM payments p
       JOIN orders o            ON o.id = p.order_id
       LEFT JOIN restaurant_tables t ON t.id = o.table_id
       ${where}
      ORDER BY p.paid_at DESC, p.id DESC
      LIMIT ? OFFSET ?`,
    [...params, filters.limit ?? 50, filters.offset ?? 0]
  );

  const [countRows] = await query(
    `SELECT COUNT(*) AS total FROM payments p JOIN orders o ON o.id = p.order_id ${where}`,
    params
  );

  return { rows: rows.map(decoratePayment), total: countRows[0].total };
}

/**
 * Refund/refund sebagian sebuah pembayaran.
 *
 * Aturan:
 *   - refund tidak boleh melebihi sisa pembayaran yang belum direfund
 *   - order hanya boleh dibatalkan lewat pembayaran yang sudah lunas direfund
 *   - sisa refund yang tidak mencukupi untuk menutup tagihan berarti order
 *     dibatalkan otomatis supaya tidak ada tagihan menggantung
 *
 * @param {object} payload
 * @param {number} payload.payment_id
 * @param {number} [payload.amount]   default: seluruh sisa yang bisa direfund
 * @param {string} [payload.reason]
 * @param {object|null} user
 */
async function refund(payload, user = null) {
  const paymentId = Number(payload.payment_id);

  const result = await withTransaction(async (conn) => {
    const [paymentRows] = await conn.execute(
      `SELECT id, order_id, method, amount, refunded_amount, status
         FROM payments
        WHERE id = ?
        FOR UPDATE`,
      [paymentId]
    );
    if (paymentRows.length === 0) throw ApiError.notFound('Pembayaran tidak ditemukan.');

    const payment = paymentRows[0];

    if (payment.status === 'REFUNDED') {
      throw ApiError.conflict('Pembayaran ini sudah direfund seluruhnya.');
    }

    const refundable = money.round(payment.amount - payment.refunded_amount);
    if (refundable <= 0) {
      throw ApiError.conflict('Tidak ada sisa pembayaran yang bisa direfund.');
    }

    const amount = money.round(payload.amount ?? refundable);
    if (amount <= 0) {
      throw ApiError.badRequest('Nominal refund harus lebih besar dari nol.');
    }
    if (amount > refundable) {
      throw ApiError.badRequest(
        `Nominal refund melebihi sisa yang bisa direfund (${money.formatRupiah(refundable)}).`
      );
    }

    const newRefunded = money.round(payment.refunded_amount + amount);
    const newStatus = newRefunded >= money.round(payment.amount) ? 'REFUNDED' : 'PARTIAL_REFUND';

    await conn.execute(
      `UPDATE payments SET refunded_amount = ?, status = ? WHERE id = ?`,
      [newRefunded, newStatus, paymentId]
    );

    const [orderRows] = await conn.execute(
      `SELECT id, order_number, status, total, paid_amount
         FROM orders
        WHERE id = ?
        FOR UPDATE`,
      [payment.order_id]
    );
    const order = orderRows[0];

    const newPaidAmount = Math.max(0, money.round(order.paid_amount - amount));
    await conn.execute(`UPDATE orders SET paid_amount = ? WHERE id = ?`, [newPaidAmount, order.id]);

    // Kalau seluruh pembayaranorder ini sudah dikembalikan, order dibatalkan
    // supaya tidak ada tagihan aktif untuk pelanggan.
    let cancelled = false;
    if (newPaidAmount === 0 && order.status !== 'COMPLETED' && order.status !== 'CANCELLED') {
      await conn.execute(
        `UPDATE orders
            SET status = 'CANCELLED', cancelled_at = NOW(), cancelled_by = ?, cancel_reason = ?
          WHERE id = ?`,
        [user ? user.id : null, payload.reason || 'Refund penuh', order.id]
      );
      await conn.execute(
        `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note)
         VALUES (?, ?, 'CANCELLED', ?, ?)`,
        [order.id, order.status, user ? user.id : null, payload.reason || 'Refund penuh']
      );
      cancelled = true;
    }

    await conn.execute(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, description, metadata)
       VALUES (?, 'REFUND', 'payment', ?, ?, ?)`,
      [
        user ? user.id : null,
        paymentId,
        `Refund ${money.formatRupiah(amount)} pada pembayaran #${paymentId}`,
        JSON.stringify({ reason: payload.reason ?? null, orderNumber: order.order_number }),
      ]
    );

    return {
      paymentId,
      orderId: order.id,
      orderNumber: order.order_number,
      refundedAmount: amount,
      totalRefunded: newRefunded,
      refundableBefore: refundable,
      paymentStatus: newStatus,
      orderCancelled: cancelled,
      orderPaidAmount: newPaidAmount,
    };
  });

  const order = await orderService.findById(result.orderId);

  await notificationService.create({
    type: 'PAYMENT',
    orderId: result.orderId,
    title: `Refund ${order.orderNumber}`,
    message: `${money.formatRupiah(result.refundedAmount)} dikembalikan. ${
      result.orderCancelled ? 'Order dibatalkan.' : `Sisa tagihan ${money.formatRupiah(order.balanceDue)}.`
    }`,
  });

  socket.emitTo(socket.ROOMS.kitchen, 'order:updated', order);
  socket.emitTo(socket.ROOMS.order(result.orderId), 'payment:refunded', {
    orderId: result.orderId,
    refundedAmount: result.refundedAmount,
    status: order.status,
    balanceDue: order.balanceDue,
  });

  return { ...result, order };
}

/** Ringkasan pembayaran per metode untuk laporan harian. */
async function summaryByMethod(from, to) {
  const [rows] = await query(
    `SELECT method,
            COUNT(*) AS transaction_count,
            SUM(amount) AS total_amount,
            SUM(refunded_amount) AS total_refunded
       FROM payments
      WHERE paid_at >= ? AND paid_at <= ? AND status IN ('SUCCESS', 'PARTIAL_REFUND', 'REFUNDED')
      GROUP BY method
      ORDER BY method`,
    [from, to]
  );

  return rows.map((row) => ({
    method: row.method,
    transactionCount: Number(row.transaction_count),
    totalAmount: money.round(row.total_amount),
    totalRefunded: money.round(row.total_refunded),
    netAmount: money.round(row.total_amount - row.total_refunded),
  }));
}

function decoratePayment(row) {
  return {
    id: Number(row.id),
    orderId: Number(row.order_id),
    orderNumber: row.order_number,
    source: row.source,
    tableCode: row.table_code,
    method: row.method,
    amount: money.round(row.amount),
    changeAmount: money.round(row.change_amount),
    status: row.status,
    refundedAmount: money.round(row.refunded_amount),
    reference: row.reference,
    note: row.note,
    paidBy: row.paid_by ? Number(row.paid_by) : null,
    paidAt: row.paid_at,
  };
}

module.exports = {
  create,
  findById,
  list,
  refund,
  summaryByMethod,
  METHODS,
  METHODS_WITHOUT_CHANGE,
};
