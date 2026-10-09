/**
 * Halaman Kasir / POS.
 *
 * Alur kasir:
 *   pilih meja -> pilih produk -> keranjang -> opsional diskon -> bayar -> struk
 *
 * Bedanya dengan halaman menu pelanggan:
 *   - wajib login (butuh permission order.create)
 *   - diskon boleh diberikan kasir
 *   - setelah bayar, struk langsung dicetak
 */

import { api, withQuery } from './api.js';
import * as cartStore from './store.js';
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
  confirmDialog,
} from './ui.js';

// Halaman ini butuh login.
if (!requireLogin({ requiredPermissions: ['order.create'] })) {
  throw new Error('unauthorized');
}

const state = {
  tables: [],
  categories: [],
  products: [],
  activeCategory: null,
  search: '',
  currentOrder: null,
};

// Scope keranjang kasir tidak per-meja: kasir boleh menggabungkan,
// jadi memakai satu scope "pos".
const SCOPE = 'pos';

document.addEventListener('DOMContentLoaded', async () => {
  showUser();

  await loadTables();
  await loadCategories();
  await loadProducts();

  renderCart();
  updateSummary();

  wireEvents();

  // Dengarkan order dari QR supaya kasir tahu ada pesanan masuk.
  const { connect, on } = await import('./socket.js');
  connect({ rooms: ['dashboard'] });
  on('order:new', (order) => {
    if (order.source === 'QR') {
      toast(`Order QR baru: ${order.orderNumber} (${order.tableCode || 'tanpa meja'})`, 'info', 5000);
    }
  });
});

function showUser() {
  try {
    const user = JSON.parse(localStorage.getItem('sr_user') || 'null');
    if (user) $('#user-label').textContent = user.name;
  } catch {
    // Tidak kritis, biarkan kosong.
  }
}

// ---------------------------------------------------------------------------
// Data master
// ---------------------------------------------------------------------------

async function loadTables() {
  try {
    state.tables = await api.get('/tables?active=1');
    $('#table-select').innerHTML =
      '<option value="">-- Pilih meja --</option>' +
      state.tables
        .map(
          (table) =>
            `<option value="${table.id}">${escapeHtml(table.code)} - ${escapeHtml(table.name)}</option>`
        )
        .join('');
  } catch (error) {
    toast(`Gagal memuat meja: ${error.message}`, 'error');
  }
}

async function loadCategories() {
  try {
    state.categories = await api.get('/categories');
    renderTabs();
  } catch (error) {
    console.error(error);
  }
}

async function loadProducts() {
  const grid = $('#product-grid');
  showLoading(grid);

  try {
    const result = await api.get(
      withQuery('/menu/products', {
        active: 1,
        category_id: state.activeCategory || undefined,
        search: state.search || undefined,
        limit: 100,
      })
    );

    state.products = Array.isArray(result) ? result : [];
    renderProducts();
  } catch (error) {
    showError(grid, error.message, loadProducts);
  }
}

function renderTabs() {
  const tabs = $('#category-tabs');
  const items = [{ id: null, name: 'Semua' }, ...state.categories];

  tabs.innerHTML = items
    .map(
      (category) => `
      <button type="button" class="tab ${category.id === state.activeCategory ? 'tab--active' : ''}"
              data-category="${category.id ?? ''}">
        ${escapeHtml(category.name)}
      </button>`
    )
    .join('');

  $$('.tab', tabs).forEach((tab) => {
    tab.addEventListener('click', () => {
      const value = tab.dataset.category;
      state.activeCategory = value ? Number(value) : null;
      renderTabs();
      loadProducts();
    });
  });
}

function renderProducts() {
  const grid = $('#product-grid');

  if (state.products.length === 0) {
    showEmpty(grid, 'Tidak ada produk yang cocok.');
    return;
  }

  grid.innerHTML = state.products
    .map(
      (product) => `
      <button type="button" class="product-card"
              data-id="${product.id}"
              ${product.stock_status !== 'AVAILABLE' ? 'disabled' : ''}>
        <div class="product-card__body">
          <p class="product-card__name">${escapeHtml(product.name)}</p>
          <p class="product-card__price">${rupiah(product.price)}</p>
          ${
            product.stock_status !== 'AVAILABLE'
              ? '<span class="badge badge--danger">Habis</span>'
              : product.variants?.length
              ? `<span class="badge badge--neutral">${product.variants.length} varian</span>`
              : ''
          }
        </div>
      </button>`
    )
    .join('');

  $$('.product-card', grid).forEach((card) => {
    card.addEventListener('click', () => {
      const product = state.products.find((p) => p.id === Number(card.dataset.id));
      openProductDialog(product);
    });
  });
}

// ---------------------------------------------------------------------------
// Dialog produk
// ---------------------------------------------------------------------------

function openProductDialog(product) {
  const hasChoices = product.variants?.length > 0 || product.addons?.length > 0;

  if (!hasChoices) {
    cartStore.addItem(SCOPE, product, {});
    refreshCart();
    return;
  }

  let selectedVariant = product.variants?.find((v) => v.is_default) || product.variants?.[0] || null;

  const dialog = modal({
    title: product.name,
    content: `
      ${
        product.variants?.length
          ? `
        <div class="field" style="margin-bottom:1rem;">
          <span class="label">Varian</span>
          <div class="payment-methods" id="variant-list">
            ${product.variants
              .map(
                (variant) => `
              <button type="button"
                      class="payment-method ${variant === selectedVariant ? 'payment-method--active' : ''}"
                      data-variant="${variant.id}"
                      data-price="${variant.price ?? product.price}"
                      data-name="${escapeHtml(variant.name)}">
                <span>${escapeHtml(variant.name)}</span>
                <span class="tiny muted">${rupiah(variant.price ?? product.price)}</span>
              </button>`
              )
              .join('')}
          </div>
        </div>`
          : ''
      }

      ${
        product.addons?.length
          ? `
        <div class="field" style="margin-bottom:1rem;">
          <span class="label">Tambahan (opsional)</span>
          <div class="stack stack--sm">
            ${product.addons
              .map(
                (addon) => `
              <label class="checkbox">
                <input type="checkbox" data-addon="${addon.id}"
                       data-name="${escapeHtml(addon.name)}" data-price="${addon.price}" />
                <span>${escapeHtml(addon.name)}
                  <span class="muted tiny">+ ${rupiah(addon.price)}</span></span>
              </label>`
              )
              .join('')}
          </div>
        </div>`
          : ''
      }

      <div class="field">
        <label class="label" for="product-qty">Jumlah</label>
        <div class="qty-control">
          <button type="button" data-qty="dec">−</button>
          <input type="number" id="product-qty" value="1" min="1" max="99"
                 style="border: none; text-align: center; width: 48px;" />
          <button type="button" data-qty="inc">+</button>
        </div>
      </div>
    `,
    footer: `
      <button type="button" class="btn btn--ghost" data-close>Batal</button>
      <button type="button" class="btn btn--primary" data-add>Tambah</button>
    `,
  });

  const root = dialog.element;

  $$('[data-variant]', root).forEach((button) => {
    button.addEventListener('click', () => {
      $$('[data-variant]', root).forEach((b) => b.classList.remove('payment-method--active'));
      button.classList.add('payment-method--active');

      selectedVariant = {
        id: Number(button.dataset.variant),
        name: button.dataset.name,
        price: Number(button.dataset.price),
      };
    });
  });

  const qtyInput = root.querySelector('#product-qty');
  root.querySelector('[data-qty="dec"]').addEventListener('click', () => {
    qtyInput.value = Math.max(1, Number(qtyInput.value) - 1);
  });
  root.querySelector('[data-qty="inc"]').addEventListener('click', () => {
    qtyInput.value = Math.min(99, Number(qtyInput.value) + 1);
  });

  root.querySelector('[data-add]').addEventListener('click', () => {
    const quantity = Math.max(1, Math.min(99, Number(qtyInput.value) || 1));

    const addons = $$('[data-addon]', root)
      .filter((input) => input.checked)
      .map((input) => ({
        id: Number(input.dataset.addon),
        name: input.dataset.name,
        price: Number(input.dataset.price),
        quantity: 1,
      }));

    cartStore.addItem(SCOPE, product, { variant: selectedVariant, addons, quantity });
    refreshCart();
    toast(`${product.name} ditambahkan.`, 'success', 1500);
    dialog.close();
  });
}

// ---------------------------------------------------------------------------
// Keranjang
// ---------------------------------------------------------------------------

function renderCart() {
  const container = $('#cart-items');
  const cart = cartStore.readCart(SCOPE);

  if (cart.items.length === 0) {
    showEmpty(container, 'Keranjang kosong. Pilih produk di sebelah kiri.');
    $('#checkout-button').disabled = true;
    return;
  }

  container.innerHTML = cart.items
    .map((item, index) => {
      const addonTotal = item.addons.reduce((sum, a) => sum + a.price * a.quantity, 0);
      const lineTotal = (item.unitPrice + addonTotal) * item.quantity;

      return `
        <div class="cart-line" data-index="${index}">
          <div class="cart-line__main">
            <div>
              <p class="cart-line__name">${escapeHtml(item.productName)}</p>
              ${
                item.variantName
                  ? `<p class="cart-line__meta">${escapeHtml(item.variantName)}</p>`
                  : ''
              }
              ${
                item.addons.length
                  ? `<p class="cart-line__meta">${item.addons
                      .map((a) => `${escapeHtml(a.name)} ×${a.quantity}`)
                      .join(', ')}</p>`
                  : ''
              }
            </div>
            <span class="cart-line__price">${rupiah(lineTotal)}</span>
          </div>
          <div class="cart-line__controls">
            <div class="qty-control">
              <button type="button" data-action="dec">−</button>
              <span class="qty-control__value">${item.quantity}</span>
              <button type="button" data-action="inc">+</button>
            </div>
            <button type="button" class="btn btn--ghost btn--small"
                    data-action="remove" style="margin-left:auto;">Hapus</button>
          </div>
        </div>`;
    })
    .join('');

  $$('.cart-line', container).forEach((line) => {
    const index = Number(line.dataset.index);
    const item = cartStore.readCart(SCOPE).items[index];

    line.querySelector('[data-action="dec"]').addEventListener('click', () => {
      cartStore.updateQuantity(SCOPE, index, item.quantity - 1);
      refreshCart();
    });
    line.querySelector('[data-action="inc"]').addEventListener('click', () => {
      cartStore.updateQuantity(SCOPE, index, item.quantity + 1);
      refreshCart();
    });
    line.querySelector('[data-action="remove"]').addEventListener('click', () => {
      cartStore.removeItem(SCOPE, index);
      refreshCart();
    });
  });

  $('#checkout-button').disabled = false;
}

function updateSummary() {
  const discountPercent = Number($('#discount-input').value) || 0;
  const totals = cartStore.estimateTotals(SCOPE, { discountPercent });

  $('#summary-subtotal').textContent = rupiah(totals.subtotal);

  const discountRow = $('#discount-row');
  discountRow.hidden = discountPercent === 0;
  $('#summary-discount').textContent = `- ${rupiah(totals.discount)}`;

  $('#summary-tax').textContent =
    `${rupiah(totals.tax + totals.serviceCharge)} ` +
    `(${totals.taxPercent}% + ${totals.serviceChargePercent}%)`;

  $('#summary-total').textContent = rupiah(totals.total);
}

function refreshCart() {
  renderCart();
  updateSummary();
}

// ---------------------------------------------------------------------------
// Muat order aktif dari meja
// ---------------------------------------------------------------------------

async function loadActiveOrder() {
  const tableId = $('#table-select').value;
  if (!tableId) {
    toast('Pilih meja terlebih dahulu.', 'warning');
    return;
  }

  try {
    const order = await api.get(`/orders/table/${tableId}/active`);

    if (!order) {
      toast('Tidak ada pesanan aktif untuk meja ini.', 'info');
      return;
    }

    state.currentOrder = order;

    const confirmed = await confirmDialog(
      'Muat pesanan meja?',
      `Keranjang kasir akan diganti dengan isi order ${order.orderNumber} (${order.status}). Lanjutkan?`,
      { confirmLabel: 'Muat' }
    );
    if (!confirmed) return;

    // Konversi isi order server menjadi bentuk keranjang lokal.
    cartStore.clearCart(SCOPE);

    // order_items menyimpan harga snapshot; untuk ditampilkan cukup.
    for (const item of order.items) {
      const product = {
        id: item.productId,
        name: item.productName,
        price: item.unitPrice,
      };
      const variant = item.variantId
        ? { id: item.variantId, name: item.variantName, price: item.unitPrice }
        : null;

      cartStore.addItem(SCOPE, product, {
        variant,
        quantity: item.quantity,
        addons: item.addons.map((a) => ({
          id: a.addonId,
          name: a.name,
          price: a.price,
          quantity: a.quantity,
        })),
      });
    }

    $('#discount-input').value = order.discountPercent;
    refreshCart();

    toast(`Order ${order.orderNumber} dimuat.`, 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

// ---------------------------------------------------------------------------
// Checkout & pembayaran
// ---------------------------------------------------------------------------

function openPaymentDialog() {
  const discountPercent = Number($('#discount-input').value) || 0;
  const totals = cartStore.estimateTotals(SCOPE, { discountPercent });

  const dialog = modal({
    title: 'Pembayaran',
    size: 'sm',
    content: `
      <div class="cart-summary" style="border: none; margin-bottom: 1rem;">
        <div class="cart-summary__row cart-summary__row--total">
          <span>Total tagihan</span>
          <span class="cart-summary__value">${rupiah(totals.total)}</span>
        </div>
      </div>

      <div class="field">
        <span class="label">Metode pembayaran</span>
        <div class="payment-methods" id="method-list">
          <button type="button" class="payment-method payment-method--active"
                  data-method="CASH">Tunai</button>
          <button type="button" class="payment-method" data-method="QRIS">QRIS</button>
          <button type="button" class="payment-method" data-method="TRANSFER">Transfer</button>
          <button type="button" class="payment-method" data-method="CARD">Kartu</button>
        </div>
      </div>

      <div class="field" id="cash-field">
        <label class="label" for="tender-input">Uang diterima</label>
        <input class="input" type="number" id="tender-input"
               min="0" step="1000" placeholder="0" />
        <div id="change-display" class="change-display" style="margin-top: 0.5rem;" hidden>
          <span>Kembalian</span>
          <span id="change-value">Rp 0</span>
        </div>
      </div>

      <p class="tiny muted" style="margin-top: 0.75rem;">
        Pembayaran pada fase ini dicatat di sistem tanpa menghubungi bank.
      </p>
    `,
    footer: `
      <button type="button" class="btn btn--ghost" data-close>Batal</button>
      <button type="button" class="btn btn--success" data-pay>Terima Pembayaran</button>
    `,
  });

  const root = dialog.element;
  let method = 'CASH';

  const tenderInput = root.querySelector('#tender-input');
  const cashField = root.querySelector('#cash-field');

  $$('[data-method]', root).forEach((button) => {
    button.addEventListener('click', () => {
      $$('[data-method]', root).forEach((b) => b.classList.remove('payment-method--active'));
      button.classList.add('payment-method--active');
      method = button.dataset.method;

      // Kolom uang diterima hanya relevan untuk pembayaran tunai.
      cashField.style.display = method === 'CASH' ? '' : 'none';
    });
  });

  tenderInput.addEventListener('input', () => {
    const tender = Number(tenderInput.value) || 0;
    const change = tender - totals.total;
    const display = root.querySelector('#change-display');

    if (tender > 0) {
      display.hidden = false;
      $('#change-value').textContent =
        change >= 0 ? rupiah(change) : `Kurang ${rupiah(Math.abs(change))}`;
      $('#change-value').className = change >= 0 ? '' : 'text-danger';
    } else {
      display.hidden = true;
    }
  });

  root.querySelector('[data-pay]').addEventListener('click', async (event) => {
    const button = event.currentTarget;

    await withBusyButton(
      button,
      (async () => {
        const tableId = Number($('#table-select').value);

        // 1. Buat order.
        const payload = cartStore.toOrderPayload(SCOPE, {
          source: 'POS',
          table_id: tableId || undefined,
          discount_percent: discountPercent,
          customer: $('#customer-input').value.trim()
            ? { name: $('#customer-input').value.trim() }
            : undefined,
        });

        const order = await api.post('/orders', payload);

        // 2. Catat pembayaran.
        const tender = method === 'CASH' ? Number(tenderInput.value) || order.total : undefined;
        const payment = await api.post('/payments', {
          order_id: order.id,
          method,
          amount: order.balanceDue,
          tender,
        });

        cartStore.clearCart(SCOPE);
        refreshCart();
        dialog.close();

        showReceipt(payment.order, payment.payment);
      })(),
      'Memproses...'
    ).catch((error) => {
      toast(error.message, 'error', 5000);
    });
  });
}

// ---------------------------------------------------------------------------
// Struk
// ---------------------------------------------------------------------------

function showReceipt(order, payment) {
  const itemsHtml = order.items
    .map(
      (item) => `
      <div>
        <div class="receipt__row">
          <span>${item.quantity}× ${escapeHtml(item.productName)}
            ${item.variantName ? `(${escapeHtml(item.variantName)})` : ''}</span>
          <span>${rupiah(item.lineTotal)}</span>
        </div>
        ${
          item.addons.length
            ? item.addons
                .map(
                  (addon) => `
          <div class="receipt__row">
            <span style="padding-left:1rem;">+ ${escapeHtml(addon.name)} ×${addon.quantity}</span>
            <span>${rupiah(addon.lineTotal)}</span>
          </div>`
                )
                .join('')
            : ''
        }
      </div>`
    )
    .join('');

  const dialog = modal({
    title: 'Struk Pembayaran',
    size: 'sm',
    content: `
      <div class="receipt">
        <div class="receipt__header">
          <strong>Smart Restaurant</strong><br />
          <span class="tiny">${dateTime(order.createdAt)}</span><br />
          <strong>${escapeHtml(order.orderNumber)}</strong><br />
          <span class="tiny">${order.tableCode ? `Meja ${escapeHtml(order.tableCode)}` : 'Tanpa meja'}</span>
        </div>

        <div class="receipt__divider"></div>
        ${itemsHtml}

        <div class="receipt__divider"></div>

        <div class="receipt__row"><span>Subtotal</span><span>${rupiah(order.subtotal)}</span></div>
        ${order.discountAmount > 0 ? `<div class="receipt__row"><span>Diskon</span><span>- ${rupiah(order.discountAmount)}</span></div>` : ''}
        <div class="receipt__row"><span>Pajak (${order.taxPercent}%)</span><span>${rupiah(order.taxAmount)}</span></div>
        <div class="receipt__row"><span>Service (${order.serviceChargePercent}%)</span><span>${rupiah(order.serviceChargeAmount)}</span></div>
        <div class="receipt__row receipt__row--total">
          <span>TOTAL</span><span>${rupiah(order.total)}</span>
        </div>

        <div class="receipt__divider"></div>

        <div class="receipt__row"><span>Bayar (${escapeHtml(payment.method)})</span><span>${rupiah(payment.amount)}</span></div>
        ${payment.changeAmount > 0 ? `<div class="receipt__row"><span>Kembalian</span><span>${rupiah(payment.changeAmount)}</span></div>` : ''}

        <div class="receipt__footer">
          Terima kasih telah makan!<br />
          ${escapeHtml(order.orderNumber)}
        </div>
      </div>
    `,
    footer: `
      <button type="button" class="btn btn--outline" data-close>Tutup</button>
      <button type="button" class="btn btn--primary" data-print>Cetak</button>
    `,
  });

  dialog.element.querySelector('[data-print]').addEventListener('click', () => {
    window.print();
  });
}

// ---------------------------------------------------------------------------
// Event umum
// ---------------------------------------------------------------------------

function wireEvents() {
  $$('.product-card', $('#product-grid')).forEach((card) => {
    card.addEventListener('click', () => {
      const product = state.products.find((p) => p.id === Number(card.dataset.id));
      if (!product) return;

      const hasOptions = product.variants?.length || product.addons?.length;
      if (!hasOptions) {
        cartStore.addItem(SCOPE, product, {});
        refreshCart();
        return;
      }
      openProductDialog(product);
    });
  });

  $('#checkout-button').addEventListener('click', openPaymentDialog);

  $('#clear-cart').addEventListener('click', async () => {
    if (cartStore.readCart(SCOPE).items.length === 0) return;

    const confirmed = await confirmDialog(
      'Kosongkan keranjang?',
      'Seluruh item yang dipilih akan dihapus.',
      { confirmLabel: 'Kosongkan', danger: true }
    );
    if (!confirmed) return;

    cartStore.clearCart(SCOPE);
    refreshCart();
  });

  $('#load-order-button').addEventListener('click', loadActiveOrder);

  $('#discount-input').addEventListener('input', updateSummary);

  $('#logout-button').addEventListener('click', async () => {
    const { api } = await import('./api.js');
    const { tokenStore } = await import('./api.js');

    try {
      await api.post('/auth/logout', { refreshToken: tokenStore.refreshToken });
    } catch {
      // tetap logout secara lokal
    }
    tokenStore.clear();
    window.location.replace('/login.html');
  });
}

// Pencarian produk
$('#search-input').addEventListener('input', (event) => {
  state.search = event.target.value.trim();
  loadProducts();
});