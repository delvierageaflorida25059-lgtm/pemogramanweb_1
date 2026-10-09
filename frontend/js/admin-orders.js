/**
 * Halaman daftar & detail pesanan untuk staff.
 *
 * Halaman ini bisa dibuka manager, admin, dan owner untuk keperluan
 * pelaporan, bukan hanya kasir.
 */

import { api, tokenStore, withQuery } from './api.js';
import {
  $,
  $$,
  escapeHtml,
  rupiah,
  dateTime,
  toast,
  modal,
  confirmDialog,
  showLoading,
  showError,
  showEmpty,
  requireLogin,
  debounce,
} from './ui.js';
import { connect, on } from './socket.js';

if (!requireLogin({ requiredPermissions: ['order.view'] })) {
  throw new Error('Akses ditolak');
}

const state = {
  page: 1,
  limit: 20,
  status: '',
  source: '',
  search: '',
  orders: [],
  canCancel: false,
};

const STATUS_LABELS = {
  PENDING: 'Menunggu',
  CONFIRMED: 'Dikonfirmasi',
  PREPARING: 'Sedang Dimasak',
  READY: 'Siap Diantar',
  COMPLETED: 'Selesai',
  CANCELLED: 'Dibatalkan',
};

document.addEventListener('DOMContentLoaded', async () => {
  $('#user-label').textContent = tokenStore.user?.name || '';

  const permissions = tokenStore.user?.permissions || [];
  const isAdmin = (tokenStore.user?.roles || []).includes('ADMIN');
  state.canCancel = isAdmin || permissions.includes('order.cancel');

  $('#logout-button').addEventListener('click', logout);

  $('#status-filter').addEventListener('change', (event) => {
    state.status = event.target.value;
    state.page = 1;
    loadOrders();
  });

  $('#source-filter').addEventListener('change', (event) => {
    state.source = event.target.value;
    state.page = 1;
    loadOrders();
  });

  $('#search-input').addEventListener(
    'input',
    debounce((event) => {
      state.search = event.target.value.trim();
      state.page = 1;
      loadOrders();
    }, 300)
  );

  // Order baru dari QR langsung muncul di daftar.
  connect({ rooms: ['dashboard'] });
  on('order:new', (order) => {
    toast(`Pesanan baru: ${order.orderNumber}`, 'success', 4000);
    loadOrders();
  });
  on('order:updated', () => loadOrders());

  await loadOrders();
});

async function loadOrders() {
  const tbody = $('#order-tbody');
  showLoading(tbody, 'Memuat pesanan...');

  try {
    const result = await api.get(
      withQuery('/orders', {
        page: state.page,
        limit: state.limit,
        status: state.status || undefined,
        source: state.source || undefined,
        search: state.search || undefined,
      })
    );

    state.orders = result.items || [];
    renderOrders(result.meta || {});
  } catch (error) {
    showError(tbody, error.message, loadOrders);
  }
}

function renderOrders(meta) {
  const tbody = $('#order-tbody');

  if (state.orders.length === 0) {
    showEmpty(tbody, 'Tidak ada pesanan yang cocok dengan filter.');
    $('#pagination').innerHTML = '';
    return;
  }

  tbody.innerHTML = state.orders
    .map(
      (order) => `
      <tr>
        <td data-label="Nomor"><strong>${escapeHtml(order.orderNumber)}</strong></td>
        <td data-label="Waktu" class="small muted">${dateTime(order.createdAt)}</td>
        <td data-label="Meja">${order.tableCode ? escapeHtml(order.tableCode) : '-'}</td>
        <td data-label="Sumber">
          <span class="badge badge--${order.source === 'QR' ? 'info' : 'neutral'}">
            ${escapeHtml(order.source)}
          </span>
        </td>
        <td data-label="Item" class="num">${order.itemCount ?? '-'}</td>
        <td data-label="Total" class="num"><strong>${rupiah(order.total)}</strong></td>
        <td data-label="Status">
          <span class="badge badge--${order.status.toLowerCase()}">
            ${escapeHtml(STATUS_LABELS[order.status] || order.status)}
          </span>
        </td>
        <td data-label="Aksi" class="table__actions-cell">
          <div class="table__actions">
            <button type="button" class="btn btn--outline btn--small" data-detail="${order.id}">
              Detail
            </button>
            ${
              state.canCancel && !['COMPLETED', 'CANCELLED'].includes(order.status)
                ? `<button type="button" class="btn btn--danger btn--small"
                     data-cancel="${order.id}">Batalkan</button>`
                : ''
            }
          </div>
        </td>
      </tr>`
    )
    .join('');

  $$('[data-detail]', tbody).forEach((button) => {
    button.addEventListener('click', () => openDetail(Number(button.dataset.detail)));
  });

  $$('[data-cancel]', tbody).forEach((button) => {
    button.addEventListener('click', () => cancelOrder(Number(button.dataset.cancel)));
  });

  renderPagination(meta);
}

function renderPagination(meta) {
  const container = $('#pagination');

  if (!meta.total) {
    container.innerHTML = '';
    return;
  }

  const { page, totalPages, total } = meta;

  container.innerHTML = `
    <span>Halaman ${page} dari ${totalPages} (total ${total} pesanan)</span>
    <div class="row">
      <button type="button" class="btn btn--outline btn--small" id="prev"
              ${page <= 1 ? 'disabled' : ''}>Sebelumnya</button>
      <button type="button" class="btn btn--outline btn--small" id="next"
              ${page >= totalPages ? 'disabled' : ''}>Berikutnya</button>
    </div>
  `;

  const prev = $('#prev');
  const next = $('#next');

  if (prev && !prev.disabled) {
    prev.addEventListener('click', () => {
      state.page -= 1;
      loadOrders();
    });
  }
  if (next && !next.disabled) {
    next.addEventListener('click', () => {
      state.page += 1;
      loadOrders();
    });
  }
}

async function openDetail(orderId) {
  const dialog = modal({
    title: 'Detail Pesanan',
    size: 'lg',
    content: '<p class="muted">Memuat...</p>',
  });

  try {
    const order = await api.get(`/orders/${orderId}`);

    const itemsHtml = order.items
      .map(
        (item) => `
        <div class="cart-line">
          <div class="cart-line__main">
            <div>
              <p class="cart-line__name">${item.quantity}× ${escapeHtml(item.productName)}</p>
              ${item.variantName ? `<p class="cart-line__meta">${escapeHtml(item.variantName)}</p>` : ''}
              ${
                item.addons.length
                  ? `<p class="cart-line__meta">${item.addons
                      .map((a) => `${escapeHtml(a.name)} ×${a.quantity}`)
                      .join(', ')}</p>`
                  : ''
              }
            </div>
            <span class="cart-line__price">${rupiah(item.lineTotal)}</span>
          </div>
        </div>`
      )
      .join('');

    const historyHtml = order.history
      .map(
        (entry) => `
        <tr>
          <td class="small">${dateTime(entry.at)}</td>
          <td><span class="badge badge--${entry.to.toLowerCase()}">${escapeHtml(entry.to)}</span></td>
          <td class="small muted">${escapeHtml(entry.by || 'sistem')}</td>
        </tr>`
      )
      .join('');

    const paymentsHtml = order.payments.length
      ? order.payments
          .map(
            (payment) => `
        <tr>
          <td>${dateTime(payment.paidAt)}</td>
          <td><strong>${escapeHtml(payment.method)}</strong></td>
          <td class="num">${rupiah(payment.amount)}</td>
          <td><span class="badge badge--${payment.status === 'SUCCESS' ? 'success' : 'warning'}">
            ${escapeHtml(payment.status)}
          </span></td>
        </tr>`
          )
          .join('')
      : '<tr><td colspan="4" class="muted text-center">Belum ada pembayaran.</td></tr>';

    dialog.element.querySelector('.modal__body').innerHTML = `
      <div class="row row--between" style="margin-bottom: 1rem;">
        <div>
          <h3 style="margin: 0;">${escapeHtml(order.orderNumber)}</h3>
          <p class="small muted mb-0">
            ${order.tableCode ? `Meja ${escapeHtml(order.tableCode)} · ` : ''}
            ${escapeHtml(order.source)} · ${dateTime(order.createdAt)}
          </p>
        </div>
        <span class="badge badge--${order.status.toLowerCase()}">
          ${escapeHtml(STATUS_LABELS[order.status] || order.status)}
        </span>
      </div>

      <div class="card" style="margin-bottom: 1rem;">
        <div class="card__body">
          <div class="cart-list">${itemsHtml}</div>
          <div class="cart-summary">
            <div class="cart-summary__row"><span>Subtotal</span>
              <span class="cart-summary__value">${rupiah(order.subtotal)}</span></div>
            ${order.discountAmount > 0
              ? `<div class="cart-summary__row"><span>Diskon (${order.discountPercent}%)</span>
                   <span class="cart-summary__value">-${rupiah(order.discountAmount)}</span></div>`
              : ''}
            <div class="cart-summary__row"><span>Pajak (${order.taxPercent}%)</span>
              <span class="cart-summary__value">${rupiah(order.taxAmount)}</span></div>
            <div class="cart-summary__row"><span>Service (${order.serviceChargePercent}%)</span>
              <span class="cart-summary__value">${rupiah(order.serviceChargeAmount)}</span></div>
            <div class="cart-summary__row cart-summary__row--total"><span>Total</span>
              <span class="cart-summary__value">${rupiah(order.total)}</span></div>
            <div class="cart-summary__row"><span>Dibayar</span>
              <span class="cart-summary__value">${rupiah(order.paidAmount)}</span></div>
          </div>
        </div>
      </div>

      <h4>Pembayaran</h4>
      <div class="table-wrapper" style="margin-bottom: 1rem;">
        <table class="table table--compact">
          <thead><tr><th>Waktu</th><th>Metode</th><th class="num">Nominal</th><th>Status</th></tr></thead>
          <tbody>${paymentsHtml}</tbody>
        </table>
      </div>

      <h4>Riwayat Status</h4>
      <div class="table-wrapper">
        <table class="table table--compact">
          <thead><tr><th>Waktu</th><th>Status</th><th>Oleh</th></tr></thead>
          <tbody>${historyHtml}</tbody>
        </table>
      </div>
    `;
  } catch (error) {
    dialog.element.querySelector('.modal__body').innerHTML = `
      <div class="alert alert--danger">${escapeHtml(error.message)}</div>
    `;
  }
}

async function cancelOrder(orderId) {
  const order = state.orders.find((o) => o.id === orderId);

  const confirmed = await confirmDialog(
    'Batalkan pesanan?',
    `Pesanan ${order.orderNumber} akan dibatalkan. Tindakan ini tercatat di audit log.`,
    { confirmLabel: 'Batalkan Pesanan', danger: true }
  );
  if (!confirmed) return;

  const reason = window.prompt('Alasan pembatalan (opsional):') ?? '';

  try {
    await api.post(`/orders/${orderId}/cancel`, { reason });
    toast('Pesanan dibatalkan.', 'success');
    loadOrders();
  } catch (error) {
    toast(error.message, 'error', 5000);
  }
}

async function logout() {
  try {
    await api.post('/auth/logout', { refreshToken: tokenStore.refreshToken });
  } catch {
    // Tetap logout lokal.
  }
  tokenStore.clear();
  window.location.replace('/index.html');
}