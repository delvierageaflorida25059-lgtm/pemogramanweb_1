/**
 * Dashboard ringkasan penjualan harian.
 *
 * Data diambil dari /api/dashboard/summary (ringkasan hari ini) dan
 * /api/dashboard/daily?date=... untuk tanggal pilihan pengguna.
 *
 * Ringkasan di sini adalah ringkasan kas sederhana:
 * pemasukan dikurangi nilai refund. BUKAN laporan laba akuntansi penuh.
 */

import { api, tokenStore } from './api.js';
import {
  $,
  $$,
  escapeHtml,
  rupiah,
  number,
  dateTime,
  showLoading,
  showError,
  toast,
  requireLogin,
} from './ui.js';
import { connect, on } from './socket.js';

if (!requireLogin({ requiredPermissions: ['report.view'] })) {
  throw new Error('Akses ditolak');
}

const state = {
  date: null,
  data: null,
};

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  $('#user-label').textContent = tokenStore.user?.name || '';
  $('#logout-button').addEventListener('click', logout);

  const today = new Date().toISOString().slice(0, 10);
  state.date = today;
  $('#date-input').value = today;

  $('#refresh-button').addEventListener('click', load);
  $('#date-input').addEventListener('change', (event) => {
    state.date = event.target.value || today;
    load();
  });

  connect({ rooms: ['dashboard'] });
  // Transaksi baru langsung memperbarui angka di layar.
  on('order:updated', () => load());
  on('payment:created', () => load());

  await load();
});

async function load() {
  const stats = $('#stats');

  try {
    const [summary, daily] = await Promise.all([
      api.get('/dashboard/summary'),
      api.get(`/dashboard/daily?date=${encodeURIComponent(state.date)}`),
    ]);

    state.data = { summary, daily };

    $('#subtitle').textContent = dateTime(`${state.date} 00:00:00`).split(',')[0];
    renderStats(daily);
    renderHourly(summary.hourly);
    renderPayments(daily.payments);
    renderBestSellers(summary.bestSellers);
    renderStatuses(summary.orderStatus);
  } catch (error) {
    showError(stats, error.message, load);
  }
}

// ---------------------------------------------------------------------------
// Kartu statistik
// ---------------------------------------------------------------------------

function renderStats(daily) {
  const sales = daily.sales;
  const payments = daily.payments.totals;

  $('#stats').innerHTML = `
    <div class="stat stat--primary">
      <span class="stat__label">Total Transaksi</span>
      <div class="stat__value">${number(sales.totalOrders)}</div>
      <div class="stat__hint">Rata-rata ${rupiah(sales.averageOrderValue)} / order</div>
    </div>

    <div class="stat stat--success">
      <span class="stat__label">Pendapatan</span>
      <div class="stat__value">${rupiah(sales.totalRevenue)}</div>
      <div class="stat__hint">Pajak ${rupiah(sales.totalTax)}</div>
    </div>

    <div class="stat">
      <span class="stat__label">Kas Masuk Bersih</span>
      <div class="stat__value">${rupiah(payments.netAmount)}</div>
      <div class="stat__hint">${number(payments.transactionCount)} transaksi</div>
    </div>

    ${
      payments.totalRefunded > 0
        ? `<div class="stat stat--danger">
             <span class="stat__label">Refund</span>
             <div class="stat__value">${rupiah(payments.totalRefunded)}</div>
             <div class="stat__hint">Dikurangi dari kas masuk</div>
           </div>`
        : ''
    }

    <div class="stat">
      <span class="stat__label">Diskon Diberikan</span>
      <div class="stat__value">${rupiah(sales.totalDiscount)}</div>
      <div class="stat__hint">Total dari seluruh order</div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Grafik penjualan per jam
// ---------------------------------------------------------------------------

function renderHourly(hourly) {
  const chart = $('#hourly-chart');
  const labels = $('#hourly-labels');

  // Jam operasional restoran: 08.00 - 23.00. Jam lain disembunyikan agar
  // grafik tidak tergorong oleh 20 kolom kosong.
  const OPEN_HOUR = 8;
  const CLOSE_HOUR = 23;

  const visible = hourly.filter((entry) => entry.hour >= OPEN_HOUR && entry.hour <= CLOSE_HOUR);
  const max = Math.max(1, ...visible.map((entry) => entry.totalRevenue));

  chart.innerHTML = visible
    .map((entry) => {
      const height = Math.round((entry.totalRevenue / max) * 100);
      const isEmpty = entry.totalRevenue === 0;

      return `
        <div class="bar-chart__bar ${isEmpty ? 'bar-chart__bar--empty' : ''}"
             style="height: ${Math.max(height, isEmpty ? 2 : 8)}%"
             title="${String(entry.hour).padStart(2, '0')}:00 - ${rupiah(entry.totalRevenue)} (${entry.totalOrders} order)">
        </div>`;
    })
    .join('');

  labels.innerHTML = visible
    .map(
      (entry) =>
        `<span class="bar-chart__label">${entry.hour % 3 === 0 ? String(entry.hour).padStart(2, '0') : ''}</span>`
    )
    .join('');
}

// ---------------------------------------------------------------------------
// Metode pembayaran
// ---------------------------------------------------------------------------

function renderPayments(payments) {
  const body = $('#payment-body');

  if (!payments.methods.length) {
    body.innerHTML =
      '<tr><td colspan="4" class="muted text-center">Belum ada pembayaran pada tanggal ini.</td></tr>';
    return;
  }

  body.innerHTML = payments.methods
    .map(
      (method) => `
      <tr>
        <td><strong>${escapeHtml(method.method)}</strong></td>
        <td class="num">${number(method.transactionCount)}</td>
        <td class="num">${rupiah(method.netAmount)}</td>
        <td class="num ${method.totalRefunded > 0 ? 'text-danger' : 'muted'}">
          ${method.totalRefunded > 0 ? `- ${rupiah(method.totalRefunded)}` : '-'}
        </td>
      </tr>`
    )
    .join('');
}

// ---------------------------------------------------------------------------
// Produk terlaris
// ---------------------------------------------------------------------------

function renderBestSellers(products) {
  const body = $('#bestseller-body');

  if (!products.length) {
    body.innerHTML =
      '<tr><td colspan="4" class="muted text-center">Belum ada penjualan pada hari ini.</td></tr>';
    return;
  }

  body.innerHTML = products
    .map(
      (product, index) => `
      <tr>
        <td class="muted">${index + 1}</td>
        <td>
          <strong>${escapeHtml(product.productName)}</strong>
          ${product.productCode ? `<div class="tiny muted">${escapeHtml(product.productCode)}</div>` : ''}
        </td>
        <td class="num">${number(product.totalQuantity)}</td>
        <td class="num">${rupiah(product.totalRevenue)}</td>
      </tr>`
    )
    .join('');
}

// ---------------------------------------------------------------------------
// Status pesanan
// ---------------------------------------------------------------------------

const STATUS_LABELS = {
  PENDING: 'Menunggu',
  CONFIRMED: 'Dikonfirmasi',
  PREPARING: 'Sedang Dimasak',
  READY: 'Siap Diantar',
  COMPLETED: 'Selesai',
  CANCELLED: 'Dibatalkan',
};

function renderStatuses(orderStatus) {
  const container = $('#status-breakdown');
  const entries = Object.entries(orderStatus.byStatus);

  if (entries.length === 0) {
    container.innerHTML = '<span class="muted">Belum ada pesanan pada tanggal ini.</span>';
    return;
  }

  container.innerHTML = entries
    .map(
      ([status, total]) => `
      <span class="badge badge--${status.toLowerCase()}" style="font-size: 0.85rem; padding: 0.4rem 0.8rem;">
        ${escapeHtml(STATUS_LABELS[status] || status)}: ${number(total)}
      </span>`
    )
    .join('');
}

// ---------------------------------------------------------------------------

async function logout() {
  try {
    await api.post('/auth/logout', { refreshToken: tokenStore.refreshToken });
  } catch {
    // Tetap logout lokal.
  }
  tokenStore.clear();
  window.location.replace('/index.html');
}