'use strict';

const { query } = require('../config/database');
const money = require('../utils/money');

/**
 * Service dashboard & laporan ringkas.
 *
 * FASE 1-3: dashboard menampilkan ringkasan penjualan hari ini, sebaran
 * metode pembayaran, produk terlaris, dan kondisi meja.
 *
 * Laporan keuangan lengkap (laba rugi, expense, cash flow) ada di Fase 6 dan
 * dan TIDAK dicampur di sini agar tidak tercampur dengan modul lain.
 */

/**
 * Rentang tanggal hari ini dalam format DATETIME.
 * Dihitung di server supaya sama dengan definisi "hari ini" dari database.
 *
 * @param {Date} [reference]
 * @returns {{from:string, to:string, date:string}}
 */
function todayRange(reference = new Date()) {
  const yyyy = reference.getFullYear();
  const mm = String(reference.getMonth() + 1).padStart(2, '0');
  const dd = String(reference.getDate()).padStart(2, '0');
  return {
    date: `${yyyy}-${mm}-${dd}`,
    from: `${yyyy}-${mm}-${dd} 00:00:00`,
    to: `${yyyy}-${mm}-${dd} 23:59:59`,
  };
}

/**
 * Ringkasan dashboard untuk owner / manager.
 * @param {object} [options]
 * @param {Date} [options.date]
 */
async function summary(options = {}) {
  const range = todayRange(options.date);

  const sales = await salesSummary(range);
  const payments = await paymentSummary(range);
  const orderStatus = await orderStatusSummary(range);
  const bestSellers = await bestSellingProducts(range, 5);
  const tables = await tableSummary();
  const hourly = await hourlySales(range);

  return {
    date: range.date,
    generatedAt: new Date().toISOString(),
    sales,
    payments,
    orderStatus,
    bestSellers,
    tables,
    hourly,
  };
}

/** @param {{from:string,to:string}} range */
async function salesSummary(range) {
  const [rows] = await query(
    `SELECT COUNT(*) AS total_orders,
            COALESCE(SUM(total), 0) AS total_revenue,
            COALESCE(SUM(discount_amount), 0) AS total_discount,
            COALESCE(SUM(tax_amount), 0) AS total_tax,
            COALESCE(AVG(total), 0) AS average_order_value
       FROM orders
      WHERE created_at BETWEEN ? AND ?
        AND status <> 'CANCELLED'`,
    [range.from, range.to]
  );

  const row = rows[0];
  const totalRevenue = money.round(row.total_revenue);

  return {
    totalOrders: Number(row.total_orders),
    totalRevenue,
    totalDiscount: money.round(row.total_discount),
    totalTax: money.round(row.total_tax),
    averageOrderValue: money.round(row.average_order_value),
  };
}

/** @param {{from:string,to:string}} range */
async function paymentSummary(range) {
  const [rows] = await query(
    `SELECT method,
            COUNT(*) AS transaction_count,
            COALESCE(SUM(amount), 0) AS total_amount,
            COALESCE(SUM(refunded_amount), 0) AS total_refunded
       FROM payments
      WHERE paid_at BETWEEN ? AND ?
      GROUP BY method
      ORDER BY total_amount DESC`,
    [range.from, range.to]
  );

  const methods = rows.map((row) => ({
    method: row.method,
    transactionCount: Number(row.transaction_count),
    totalAmount: money.round(row.total_amount),
    totalRefunded: money.round(row.total_refunded),
    netAmount: money.round(row.total_amount - row.total_refunded),
  }));

  const totals = methods.reduce(
    (acc, item) => {
      acc.transactionCount += item.transactionCount;
      acc.totalAmount = money.round(acc.totalAmount + item.totalAmount);
      acc.totalRefunded = money.round(acc.totalRefunded + item.totalRefunded);
      acc.netAmount = money.round(acc.netAmount + item.netAmount);
      return acc;
    },
    { transactionCount: 0, totalAmount: 0, totalRefunded: 0, netAmount: 0 }
  );

  return { methods, totals };
}

/** @param {{from:string,to:string}} range */
async function orderStatusSummary(range) {
  const [rows] = await query(
    `SELECT source, status, COUNT(*) AS total
       FROM orders
      WHERE created_at BETWEEN ? AND ?
      GROUP BY source, status`,
    [range.from, range.to]
  );

  const byStatus = {};
  const bySource = { QR: 0, POS: 0 };
  let grandTotal = 0;

  for (const row of rows) {
    const total = Number(row.total);
    byStatus[row.status] = (byStatus[row.status] || 0) + total;
    bySource[row.source] = (bySource[row.source] || 0) + total;
    grandTotal += total;
  }

  return { byStatus, bySource, grandTotal };
}

/**
 * @param {{from:string,to:string}} range
 * @param {number} [limit=5]
 */
async function bestSellingProducts(range, limit = 5) {
  const [rows] = await query(
    `SELECT oi.product_id,
            oi.product_name,
            oi.product_code,
            SUM(oi.quantity) AS total_quantity,
            SUM(oi.line_total) AS total_revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE o.created_at BETWEEN ? AND ?
        AND o.status <> 'CANCELLED'
      GROUP BY oi.product_id, oi.product_name, oi.product_code
      ORDER BY total_quantity DESC, total_revenue DESC
      LIMIT ?`,
    [range.from, range.to, Number(limit)]
  );

  return rows.map((row) => ({
    productId: Number(row.product_id),
    productName: row.product_name,
    productCode: row.product_code,
    totalQuantity: Number(row.total_quantity),
    totalRevenue: money.round(row.total_revenue),
  }));
}

async function tableSummary() {
  const [rows] = await query(
    `SELECT status, COUNT(*) AS total
       FROM restaurant_tables
      WHERE is_active = 1
      GROUP BY status`
  );

  const byStatus = { AVAILABLE: 0, OCCUPIED: 0, RESERVED: 0, DISABLED: 0 };
  let total = 0;
  for (const row of rows) {
    byStatus[row.status] = Number(row.total);
    total += Number(row.total);
  }
  return { byStatus, total };
}

/** Penjualan per jam untuk grafik hari ini. @param {{from:string,to:string}} range */
async function hourlySales(range) {
  const [rows] = await query(
    `SELECT HOUR(created_at) AS hour,
            COUNT(*) AS total_orders,
            COALESCE(SUM(total), 0) AS total_revenue
       FROM orders
      WHERE created_at BETWEEN ? AND ?
        AND status <> 'CANCELLED'
      GROUP BY HOUR(created_at)
      ORDER BY hour ASC`,
    [range.from, range.to]
  );

  const map = new Map(
    rows.map((row) => [Number(row.hour), {
      hour: Number(row.hour),
      totalOrders: Number(row.total_orders),
      totalRevenue: money.round(row.total_revenue),
    }])
  );

  // Lengkapi jam yang kosong supaya grafik tidak bolong.
  return Array.from({ length: 24 }, (_, hour) => map.get(hour) || {
    hour,
    totalOrders: 0,
    totalRevenue: 0,
  });
}

/**
 * Pendapatan bersih satu tanggal tertentu (dipakai halaman laporan harian).
 * @param {string} date  format YYYY-MM-DD
 */
async function dailyFinance(date) {
  const range = { date, from: `${date} 00:00:00`, to: `${date} 23:59:59` };
  const [sales, payments, orderStatus] = await Promise.all([
    salesSummary(range),
    paymentSummary(range),
    orderStatusSummary(range),
  ]);

  return {
    date,
    sales,
    payments,
    orderStatus,
    // Ringkasan kas sederhana: pemasukan dikurangi nilai refund.
    // BUKAN laporan laba akuntansi penuh.
    netCash: money.round(payments.totals.netAmount),
  };
}

module.exports = { summary, dailyFinance, todayRange };
