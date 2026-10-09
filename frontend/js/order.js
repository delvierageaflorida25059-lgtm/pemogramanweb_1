/**
 * Halaman lacak status pesanan.
 *
 * Dua sumber data dipakai bersamaan:
 *   1. polling HTTP ke /api/orders/track/:orderNumber (selalu ada)
 *   2. Socket.IO ke room "order:<id>" untuk pembaruan instan
 *
 * Halaman ini publik: pelanggan tidak harus login untuk melihat statusnya.
 */

import { api } from './api.js';
import { connect, on } from './socket.js';
import { $, escapeHtml, rupiah, dateTime, toast, showLoading, showError } from './ui.js';

const params = new URLSearchParams(window.location.search);

const state = {
  orderId: null,
  orderNumber: params.get('number') || sessionStorage.getItem('last_order_number'),
  token: params.get('token'),
  pollTimer: null,
};

// Tahap status beserta labelnya.
const STAGES = [
  { key: 'PENDING', label: 'Diterima' },
  { key: 'CONFIRMED', label: 'Dikonfirmasi' },
  { key: 'PREPARING', label: 'Sedang dimasak' },
  { key: 'READY', label: 'Siap diantar' },
  { key: 'COMPLETED', label: 'Selesai' },
];

document.addEventListener('DOMContentLoaded', () => {
  wireSearch();

  if (!state.orderNumber) {
    $('#order-body').innerHTML = `
      <div class="state">
        <p class="state__message">Masukkan nomor pesanan untuk melihat statusnya.</p>
      </div>
    `;
    $('#order-meta').textContent = 'Belum ada pesanan yang ditampilkan.';
    return;
  }

  $('#order-number-input').value = state.orderNumber;
  track(state.orderNumber);
});

function wireSearch() {
  $('#search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const value = $('#order-number-input').value.trim();
    if (!value) return;

    state.orderNumber = value;
    track(value);
  });
}

// ---------------------------------------------------------------------------
// Lacak
// ---------------------------------------------------------------------------

async function track(orderNumber) {
  showLoading($('#order-body'), 'Mengambil status pesanan...');

  try {
    const order = await api.get(
      `/orders/track/${encodeURIComponent(orderNumber)}`,
      { auth: false }
    );

    state.orderId = order.id;
    render(order);

    subscribeRealtime();
    startPolling();
  } catch (error) {
    showError($('#order-body'), error.message, () => track(orderNumber));
    $('#order-meta').textContent = 'Pesanan tidak ditemukan.';
  }
}

function render(order) {
  $('#order-meta').textContent = [
    `Meja ${order.tableCode || '-'}`,
    `Dibuat ${dateTime(order.createdAt)}`,
  ].join(' · ');

  renderProgress(order);
  renderBody(order);
}

function renderProgress(order) {
  const cancelled = order.status === 'CANCELLED';

  $('#progress').innerHTML = STAGES.map((stage, index) => {
    const done = !cancelled && index <= currentStageIndex(order.status);
    const active = !cancelled && index === currentStageIndex(order.status);

    return `
      <div class="progress__step ${done ? 'progress__step--done' : ''} ${active ? 'progress__step--active' : ''}">
        <div class="progress__dot">${done ? '✓' : index + 1}</div>
        <div class="progress__label">${escapeHtml(stage.label)}</div>
      </div>
    `;
  }).join('');
}

function currentStageIndex(status) {
  const index = STAGES.findIndex((stage) => stage.key === status);
  return index >= 0 ? index : 0;
}

function renderBody(order) {
  const itemsHtml = order.items
    .map(
      (item) => `
      <div class="cart-line">
        <div class="cart-line__main">
          <div>
            <p class="cart-line__name">${item.quantity}× ${escapeHtml(item.productName)}</p>
            ${
              item.addons?.length
                ? `<p class="cart-line__meta">${item.addons
                    .map((addon) => `${escapeHtml(addon.name)} ×${addon.quantity}`)
                    .join(', ')}</p>`
                : ''
            }
          </div>
          <span class="cart-line__price">${rupiah(item.lineTotal)}</span>
        </div>
      </div>
    `
    )
    .join('');

  const cancelled = order.status === 'CANCELLED';
  const isPaid = order.balanceDue <= 0 && !cancelled;

  $('#order-body').innerHTML = `
    <div class="alert alert--${cancelled ? 'danger' : isPaid ? 'success' : 'info'}"
         style="margin-bottom: 1rem;">
      <strong>${escapeHtml(order.statusLabel)}</strong>
      ${
        cancelled
          ? ' — Pesanan Anda telah dibatalkan. Silakan hubungi kasir bila ada pertanyaan.'
          : isPaid
          ? ' — Pembayaran Anda sudah kami terima.'
          : ` — Sisa tagihan ${rupiah(order.balanceDue)} belum dibayar.`
      }
    </div>

    <div class="cart-list">${itemsHtml}</div>

    <div class="cart-summary">
      <div class="cart-summary__row">
        <span>Subtotal</span>
        <span class="cart-summary__value">${rupiah(order.subtotal)}</span>
      </div>
      <div class="cart-summary__row">
        <span>Pajak (${order.taxPercent}%)</span>
        <span class="cart-summary__value">${rupiah(order.taxAmount)}</span>
      </div>
      <div class="cart-summary__row">
        <span>Service charge (${order.serviceChargePercent}%)</span>
        <span class="cart-summary__value">${rupiah(order.serviceChargeAmount)}</span>
      </div>
      <div class="cart-summary__row cart-summary__row--total">
        <span>Total</span>
        <span class="cart-summary__value">${rupiah(order.total)}</span>
      </div>
      ${
        !isPaid && !cancelled
          ? `<div class="cart-summary__row">
              <span>Sudah dibayar</span>
              <span class="cart-summary__value">${rupiah(order.paidAmount)}</span>
             </div>
             <div class="cart-summary__row cart-summary__row--total">
              <span>Sisa</span>
              <span class="cart-summary__value">${rupiah(order.balanceDue)}</span>
             </div>`
          : ''
      }
    </div>

    <p class="small muted text-center" style="margin-top: 1rem;">
      Diperbarui otomatis setiap beberapa detik.
    </p>
  `;
}

// ---------------------------------------------------------------------------
// Realtime + polling
// ---------------------------------------------------------------------------

let socketReady = false;

function subscribeRealtime() {
  connect({ rooms: [`order:${state.orderId}`] });

  if (socketReady) return;
  socketReady = true;

  on('order:status', () => {
    // Status berubah di dapur: ambil ulang data terbaru.
    track(state.orderNumber);
  });

  on('payment:success', () => track(state.orderNumber));
  on('payment:refunded', () => track(state.orderNumber));
}

/**
 * Polling serves as fallback when the socket is blocked (mis. di belakang
 * proxy yang tidak menyertakan upgrade WebSocket).
 */
function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);

  state.pollTimer = setInterval(() => {
    if (document.hidden) return;
    if (!state.orderNumber) return;
    track(state.orderNumber);
  }, 15000);
}