/**
 * Halaman riwayat pembayaran & refund.
 *
 * Catatan: refund hanya bisa dilakukan pengguna dengan permission
 * payment.refund (manager/admin), bukan kasir biasa.
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
  showLoading,
  showError,
  showEmpty,
  requireLogin,
  withBusyButton,
} from './ui.js';

if (!requireLogin({ requiredPermissions: ['payment.view'] })) {
  throw new Error('Akses ditolak');
}

const state = {
  page: 1,
  limit: 20,
  from: '',
  to: '',
  payments: [],
  canRefund: false,
};

document.addEventListener('DOMContentLoaded', async () => {
  $('#user-label').textContent = tokenStore.user?.name || '';

  const permissions = tokenStore.user?.permissions || [];
  const isAdmin = (tokenStore.user?.roles || []).includes('ADMIN');
  state.canRefund = isAdmin || permissions.includes('payment.refund');

  // Default: tampilkan pembayaran hari ini.
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  $('#from-date').value = todayStr;
  $('#to-date').value = todayStr;

  $('#logout-button').addEventListener('click', logout);
  $('#filter-button').addEventListener('click', () => {
    state.from = $('#from-date').value;
    state.to = $('#to-date').value;
    state.page = 1;
    loadPayments();
  });

  await loadPayments();
});

async function loadPayments() {
  const tbody = $('#payment-tbody');
  showLoading(tbody, 'Memuat pembayaran...');

  try {
    // Rentang tanggal dikunci ke 00:00:00 - 23:59:59 agar mencakup
    // seluruh pembayaran pada tanggal tersebut.
    const result = await api.get(
      withQuery('/payments', {
        page: state.page,
        limit: state.limit,
        from: state.from ? `${state.from} 00:00:00` : undefined,
        to: state.to ? `${state.to} 23:59:59` : undefined,
      })
    );

    state.payments = result.items || [];
    renderPayments(result.meta || {});
    renderStats();
  } catch (error) {
    showError(tbody, error.message, loadPayments);
  }
}

function renderPayments(meta) {
  const tbody = $('#payment-tbody');

  if (state.payments.length === 0) {
    showEmpty(tbody, 'Tidak ada pembayaran pada rentang tanggal ini.');
    $('#pagination').innerHTML = '';
    return;
  }

  tbody.innerHTML = state.payments
    .map(
      (payment) => `
      <tr>
        <td data-label="Waktu" class="small muted">${dateTime(payment.paidAt)}</td>
        <td data-label="Order"><strong>${escapeHtml(payment.orderNumber)}</strong></td>
        <td data-label="Meja">${payment.tableCode ? escapeHtml(payment.tableCode) : '-'}</td>
        <td data-label="Metode">
          <span class="badge badge--neutral">${escapeHtml(payment.method)}</span>
        </td>
        <td data-label="Nominal" class="num">${rupiah(payment.amount)}</td>
        <td data-label="Refund" class="num ${payment.refundedAmount > 0 ? 'text-danger' : 'muted'}">
          ${payment.refundedAmount > 0 ? `- ${rupiah(payment.refundedAmount)}` : '-'}
        </td>
        <td data-label="Status">
          <span class="badge badge--${badgeFor(payment.status)}">
            ${escapeHtml(payment.status)}
          </span>
        </td>
        <td data-label="Aksi" class="table__actions-cell">
          ${
            state.canRefund && payment.status !== 'REFUNDED' && payment.refundedAmount < payment.amount
              ? `<button type="button" class="btn btn--outline btn--small"
                   data-refund="${payment.id}"
                   data-max="${payment.amount - payment.refundedAmount}">Refund</button>`
              : ''
          }
        </td>
      </tr>`
    )
    .join('');

  $$('[data-refund]', tbody).forEach((button) => {
    button.addEventListener('click', () => {
      const payment = state.payments.find((p) => p.id === Number(button.dataset.refund));
      openRefundDialog(payment);
    });
  });

  renderPagination(meta);
}

function badgeFor(status) {
  return (
    {
      SUCCESS: 'success',
      REFUNDED: 'danger',
      PARTIAL_REFUND: 'warning',
      PENDING: 'warning',
      FAILED: 'danger',
    }[status] || 'neutral'
  );
}

function renderStats() {
  const totalAmount = state.payments.reduce((sum, p) => sum + p.amount, 0);
  const totalRefunded = state.payments.reduce((sum, p) => sum + p.refundedAmount, 0);

  $('#stats').innerHTML = `
    <div class="stat stat--primary">
      <span class="stat__label">Jumlah Transaksi</span>
      <div class="stat__value">${state.payments.length}</div>
    </div>
    <div class="stat stat--success">
      <span class="stat__label">Total Pembayaran</span>
      <div class="stat__value">${rupiah(totalAmount)}</div>
    </div>
    <div class="stat stat--danger">
      <span class="stat__label">Total Refund</span>
      <div class="stat__value">${rupiah(totalRefunded)}</div>
    </div>
    <div class="stat">
      <span class="stat__label">Kas Masuk Bersih</span>
      <div class="stat__value">${rupiah(totalAmount - totalRefunded)}</div>
    </div>
  `;
}

function renderPagination(meta) {
  const container = $('#pagination');

  if (!meta.total) {
    container.innerHTML = '';
    return;
  }

  const { page, totalPages, total } = meta;

  container.innerHTML = `
    <span>Halaman ${page} dari ${totalPages} (total ${total} transaksi)</span>
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
      loadPayments();
    });
  }
  if (next && !next.disabled) {
    next.addEventListener('click', () => {
      state.page += 1;
      loadPayments();
    });
  }
}

function openRefundDialog(payment) {
  const maxRefund = payment.amount - payment.refundedAmount;

  const dialog = modal({
    title: `Refund Pembayaran ${payment.orderNumber}`,
    size: 'sm',
    content: `
      <div class="alert alert--info" style="margin-bottom: 1rem;">
        Nominal dibayar: <strong>${rupiah(payment.amount)}</strong><br />
        Sudah direfund: <strong>${rupiah(payment.refundedAmount)}</strong><br />
        Maksimal refund: <strong>${rupiah(maxRefund)}</strong>
      </div>

      <div class="field">
        <label class="label" for="refund-amount">Nominal Refund <span class="required">*</span></label>
        <input class="input" type="number" id="refund-amount"
               min="1" max="${maxRefund}" step="1000" value="${maxRefund}" />
        <p class="field__hint">Isi nominal penuh untuk refund seluruhnya.</p>
      </div>

      <div class="field">
        <label class="label" for="refund-reason">Alasan Refund</label>
        <textarea class="textarea" id="refund-reason" maxlength="255"
                  placeholder="Contoh: Pesanan tidak sampai / salah pesan"></textarea>
      </div>

      ${
        payment.method === 'CASH'
          ? '<div class="alert alert--warning">Pengembalian dana tunai erfolgt secara manual di kasir.</div>'
          : ''
      }
    `,
    footer: `
      <button type="button" class="btn btn--ghost" data-close>Batal</button>
      <button type="button" class="btn btn--danger" data-process>Proses Refund</button>
    `,
  });

  dialog.element.querySelector('[data-process]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const amount = Number($('#refund-amount').value);
    const reason = $('#refund-reason').value.trim();

    if (!amount || amount <= 0) {
      toast('Nominal refund harus lebih besar dari nol.', 'error');
      return;
    }
    if (amount > maxRefund) {
      toast(`Nominal maksimal ${rupiah(maxRefund)}.`, 'error');
      return;
    }

    await withBusyButton(
      button,
      (async () => {
        try {
          const result = await api.post('/payments/refund', {
            payment_id: payment.id,
            amount,
            reason,
          });

          dialog.close();
          toast(
            result.orderCancelled
              ? 'Refund penuh diproses dan pesanan dibatalkan.'
              : `Refund ${rupiah(amount)} diproses.`,
            'success',
            5000
          );
          loadPayments();
        } catch (error) {
          toast(error.message, 'error', 5000);
        }
      })(),
      'Memproses...'
    );
  });
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