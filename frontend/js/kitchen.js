/**
 * Halaman Kitchen Display System (KDS).
 *
 * Papan menampilkan order aktif dikelompokkan per tahap:
 *   MENUNGGU -> DIPROFESKAN -> DIPASAK -> SIAP
 *
 * Pembaruan datang realtime lewat Socket.IO, dengan polling 30 detik
 * sebagai jaring pengaman bila socket tidak terhubung.
 */

import { api, tokenStore } from './api.js';
import {
  $,
  $$,
  escapeHtml,
  timeOnly,
  timeAgo,
  toast,
  showError,
  requireLogin,
  withBusyButton,
} from './ui.js';
import { connect, on, isConnected } from './socket.js';

if (!requireLogin({ requiredPermissions: ['kitchen.view'] })) {
  throw new Error('Akses ditolak');
}

// Urutan kolom di papan.
const COLUMNS = [
  { key: 'PENDING', label: 'Menunggu', empty: 'Tidak ada pesanan menunggu' },
  { key: 'CONFIRMED', label: 'Dikonfirmasi', empty: 'Tidak ada pesanan dikonfirmasi' },
  { key: 'PREPARING', label: 'Sedang Dimasak', empty: 'Tidak ada pesanan dimasak' },
  { key: 'READY', label: 'Siap Diantar', empty: 'Tidak ada pesanan siap' },
];

const state = {
  columns: {},
  pollTimer: null,
};

document.addEventListener('DOMContentLoaded', async () => {
  wireEvents();
  startClock();
  await loadBoard();
  startRealtime();
  startPolling();
});

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------

function startRealtime() {
  connect({ rooms: ['kitchen'] });

  // Order baru langsung muncul tanpa perlu refresh.
  on('order:new', (order) => {
    toast(`Pesanan baru: ${order.orderNumber}`, 'success', 5000);
    loadBoard();
  });

  // Status berubah (oleh dapur lain atau kasir) -> segarkan papan.
  on('order:updated', () => loadBoard());

  // Pembayaran masuk berarti pesanan sah untuk dimasak.
  on('payment:created', () => loadBoard());
}

function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);

  // Polling cukup jarang karena socket sudah menangani update cepat.
  state.pollTimer = setInterval(() => {
    if (document.hidden) return;
    loadBoard();
  }, 30_000);
}

// ---------------------------------------------------------------------------
// Papan
// ---------------------------------------------------------------------------

async function loadBoard() {
  try {
    const board = await api.get('/kitchen/board');
    state.columns = board.columns || {};
    renderBoard();
  } catch (error) {
    showError($('#board'), error.message, loadBoard);
  }
}

function renderBoard() {
  const board = $('#board');

  board.innerHTML = COLUMNS.map((column) => {
    const data = state.columns[column.key] || { orders: [] };
    const orders = data.orders || [];

    const tickets = orders.length === 0
      ? `<div class="state" style="padding: 2rem 1rem;">
           <p class="state__message">${escapeHtml(column.empty)}</p>
         </div>`
      : orders.map(renderTicket).join('');

    return `
      <div class="kitchen-column">
        <div class="kitchen-column__header">
          <span class="kitchen-column__title">${escapeHtml(column.label)}</span>
          <span class="kitchen-column__count">${orders.length}</span>
        </div>
        ${tickets}
      </div>
    `;
  }).join('');

  bindTicketActions();
}

/**
 * Render satu tiket pesanan.
 * @param {object} order
 */
function renderTicket(order) {
  const itemsHtml = order.kitchenItems
    .map(
      (item) => `
      <li class="kitchen-ticket__item">
        <span class="kitchen-ticket__qty">${item.quantity}×</span>
        <span>
          ${escapeHtml(item.name)}
          ${item.variant ? `<span class="muted tiny">(${escapeHtml(item.variant)})</span>` : ''}
          ${item.note ? `<div class="tiny text-warning">${escapeHtml(item.note)}</div>` : ''}
        </span>
      </li>`
    )
    .join('');

  // Kartu yang sudah lama di status ini diberi penanda agar mudah didahulukan.
  const isOld = isOlderThanMinutes(order.updatedAt, 15);

  return `
    <article class="kitchen-ticket kitchen-ticket--${order.status.toLowerCase()}"
             data-order-id="${order.id}">
      <div class="kitchen-ticket__header">
        <span class="kitchen-ticket__number">${escapeHtml(order.orderNumber)}</span>
        ${
          order.tableCode
            ? `<span class="kitchen-ticket__table">Meja ${escapeHtml(order.tableCode)}</span>`
            : '<span class="kitchen-ticket__table">Take Away</span>'
        }
      </div>

      <div class="kitchen-ticket__time">
        ${timeOnly(order.createdAt)} · ${escapeHtml(timeAgo(order.createdAt))}
        ${order.source === 'QR' ? ' · QR' : ''}
      </div>

      <ul class="kitchen-ticket__items">${itemsHtml}</ul>

      ${
        order.note
          ? `<div class="alert alert--warning tiny" style="margin-bottom:0.5rem;">
               ${escapeHtml(order.note)}
             </div>`
          : ''
      }

      ${
        order.nextAction
          ? `<button type="button"
                     class="btn btn--primary btn--small btn--block"
                     data-action="advance"
                     data-id="${order.id}"
                     data-next="${order.nextAction.to}">
               ${escapeHtml(order.nextAction.label)}
             </button>`
          : '<div class="tiny muted text-center">Selesai</div>'
      }

      ${isOld ? '<div class="tiny text-danger" style="margin-top:0.35rem;">Menunggu lama</div>' : ''}
    </article>
  `;
}

/** True kalau order sudah lebih dari N menit pada tahap ini. */
function isOlderThanMinutes(timestamp, minutes) {
  if (!timestamp) return false;
  const then = new Date(String(timestamp).replace(' ', 'T')).getTime();
  if (Number.isNaN(then)) return false;
  return Date.now() - then > minutes * 60_000;
}

function bindTicketActions() {
  $$('[data-action="advance"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const orderId = Number(button.dataset.id);
      const nextStatus = button.dataset.next;

      await withBusyButton(
        button,
        (async () => {
          const order = await api.patch(`/kitchen/orders/${orderId}/status`, {
            status: nextStatus,
          });

          toast(`${order.orderNumber} → ${order.status}`, 'success', 2500);

          // Papan dimuat ulang supaya urutan kolom ikut berubah.
          await loadBoard();
        })(),
        '...'
      ).catch((error) => {
        toast(error.message, 'error', 5000);
        loadBoard();
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Jam
// ---------------------------------------------------------------------------

function startClock() {
  const element = $('#clock');

  const tick = () => {
    element.textContent = new Intl.DateTimeFormat('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date());
  };

  tick();
  setInterval(tick, 1000);

  // Indikator koneksi realtime.
  const indicator = $('#socket-indicator');
  setInterval(() => {
    indicator.style.background = isConnected() ? 'var(--color-success)' : 'var(--color-danger)';
    indicator.title = isConnected() ? 'Terhubung realtime' : 'Koneksi realtime terputus';
  }, 2000);
}

// ---------------------------------------------------------------------------
// Event umum
// ---------------------------------------------------------------------------

function wireEvents() {
  $('#refresh-button').addEventListener('click', loadBoard);

  $('#logout-button').addEventListener('click', async () => {
    try {
      await api.post('/auth/logout', { refreshToken: tokenStore.refreshToken });
    } catch {
      // Tetap logout lokal.
    }
    tokenStore.clear();
    window.location.replace('/index.html');
  });
}