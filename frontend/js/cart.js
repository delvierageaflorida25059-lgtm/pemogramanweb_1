/**
 * Halaman keranjang dan checkout QR.
 *
 * Harga final SELALU dihitung ulang oleh server. Angka yang tampil di layar
 * hanyalah perkiraan supaya pelanggan bisa melihat total sebelum mengirim.
 */

import { api } from './api.js';
import * as cartStore from './store.js';
import {
  $,
  $$,
  escapeHtml,
  rupiah,
  toast,
  showEmpty,
  confirmDialog,
  withBusyButton,
} from './ui.js';

const params = new URLSearchParams(window.location.search);
const qrToken = params.get('token');
const tableCode = params.get('table');

// Persentase pajak/service charge diisi setelah order pertama berhasil.
// Nilai default hanya untuk tampilan; server yang jadi acuan.
let TAX_PERCENT = 10;
let SERVICE_PERCENT = 5;

function cartScope() {
  return tableCode || 'guest';
}

document.addEventListener('DOMContentLoaded', () => {
  if (tableCode) $('#table-info').textContent = `Meja ${tableCode}`;

  renderCart();
  wireSubmit();
});

// ---------------------------------------------------------------------------
// Render keranjang
// ---------------------------------------------------------------------------

function renderCart() {
  const container = $('#cart-items');
  const cart = cartStore.readCart(cartScope());

  if (cart.items.length === 0) {
    showEmpty(container, 'Keranjang masih kosong.');
    $('#submit-button').disabled = true;
    updateSummary();
    return;
  }

  container.innerHTML = cart.items
    .map((item, index) => {
      const addonTotal = item.addons.reduce((sum, a) => sum + a.price * a.quantity, 0);
      const lineTotal = (item.unitPrice + addonTotal) * item.quantity;

      const addonsHtml = item.addons.length
        ? `<p class="cart-line__meta">${item.addons
            .map((addon) => `${escapeHtml(addon.name)} x${addon.quantity}`)
            .join(', ')}</p>`
        : '';

      const variantHtml = item.variantName
        ? `<p class="cart-line__meta">${escapeHtml(item.variantName)}</p>`
        : '';

      return `
        <div class="cart-line" data-index="${index}">
          <div class="cart-line__main">
            <div>
              <p class="cart-line__name">${escapeHtml(item.productName)}</p>
              ${variantHtml}
              ${addonsHtml}
              ${item.note ? `<p class="cart-line__meta">Catatan: ${escapeHtml(item.note)}</p>` : ''}
            </div>
            <span class="cart-line__price">${rupiah(lineTotal)}</span>
          </div>

          <div class="cart-line__controls">
            <div class="qty-control">
              <button type="button" data-action="dec" aria-label="Kurangi">−</button>
              <span class="qty-control__value">${item.quantity}</span>
              <button type="button" data-action="inc" aria-label="Tambah">+</button>
            </div>
            <button type="button" class="btn btn--ghost btn--small"
                    data-action="remove" style="margin-left: auto;">
              Hapus
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  $$('.cart-line', container).forEach((line) => {
    const index = Number(line.dataset.index);

    line.querySelector('[data-action="dec"]').addEventListener('click', () => {
      const item = cartStore.readCart(cartScope()).items[index];
      cartStore.updateQuantity(cartScope(), index, item.quantity - 1);
      renderCart();
    });

    line.querySelector('[data-action="inc"]').addEventListener('click', () => {
      const item = cartStore.readCart(cartScope()).items[index];
      if (item.quantity >= 99) {
        toast('Quantity maksimal 99 per item.', 'warning');
        return;
      }
      cartStore.updateQuantity(cartScope(), index, item.quantity + 1);
      renderCart();
    });

    line.querySelector('[data-action="remove"]').addEventListener('click', async () => {
      const item = cartStore.readCart(cartScope()).items[index];
      const confirmed = await confirmDialog(
        'Hapus item?',
        `Hapus "${item.productName}" dari keranjang?`,
        { confirmLabel: 'Hapus', danger: true }
      );
      if (confirmed) {
        cartStore.removeItem(cartScope(), index);
        renderCart();
      }
    });
  });

  $('#submit-button').disabled = false;
  updateSummary();
}

function updateSummary() {
  const totals = cartStore.estimateTotals(cartScope(), {
    taxPercent: TAX_PERCENT,
    serviceChargePercent: SERVICE_PERCENT,
  });

  $('#summary-subtotal').textContent = rupiah(totals.subtotal);

  // Baris pajak dan service charge disembunyikan kalau persentasenya 0.
  const taxRow = $('#summary-tax-row');
  taxRow.hidden = TAX_PERCENT === 0;
  $('#summary-tax-percent').textContent = `(${TAX_PERCENT}%)`;
  $('#summary-tax').textContent = rupiah(totals.tax);

  const serviceRow = $('#summary-service-row');
  serviceRow.hidden = SERVICE_PERCENT === 0;
  $('#summary-service-percent').textContent = `(${SERVICE_PERCENT}%)`;
  $('#summary-service').textContent = rupiah(totals.serviceCharge);

  $('#summary-total').textContent = rupiah(totals.total);
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

function wireSubmit() {
  const button = $('#submit-button');

  button.addEventListener('click', async () => {
    if (!qrToken && !tableCode) {
      toast('Pesan tanpa meja tidak bisa dikirim. Scan QR meja terlebih dahulu.', 'warning');
      return;
    }

    const cart = cartStore.readCart(cartScope());
    if (cart.items.length === 0) {
      toast('Keranjang masih kosong.', 'warning');
      return;
    }

    const confirmed = await confirmDialog(
      'Kirim pesanan?',
      'Pesanan akan langsung masuk ke dapur dan tidak bisa diubah setelah dikirim.',
      { confirmLabel: 'Ya, kirim' }
    );
    if (!confirmed) return;

    await withBusyButton(
      button,
      (async () => {
        const customerName = $('#customer-name').value.trim();
        const customerPhone = $('#customer-phone').value.trim();
        const note = $('#order-note').value.trim();

        const payload = cartStore.toOrderPayload(cartScope(), {
          source: 'QR',
          ...(qrToken ? { tableToken: qrToken } : {}),
          ...(!qrToken && tableCode ? { tableCode } : {}),
          ...(customerName || customerPhone
            ? { customer: { name: customerName, phone: customerPhone } }
            : {}),
          ...(note ? { note } : {}),
        });

        // src untuk order.routes.js: jika hanya ada tableCode (bukan token),
        // backend memerlukan table_id. Untuk flow QR normal selalu ada token.
        const order = await api.post('/orders', payload, { auth: false });

        cartStore.clearCart(cartScope());

        // Simpan nomor order supaya halaman lacak bisa menampilkannya.
        sessionStorage.setItem('last_order_id', String(order.id));
        sessionStorage.setItem('last_order_number', order.orderNumber);

        const target = qrToken ? `?token=${qrToken}` : `?table=${tableCode}`;
        window.location.href = `/order.html${target}&id=${order.id}`;
      })(),
      'Mengirim...'
    ).catch((error) => {
      toast(error.message, 'error', 5000);
    });
  });
}