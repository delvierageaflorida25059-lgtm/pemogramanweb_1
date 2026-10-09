/**
 * Halaman menu untuk pelanggan.
 *
 * Alur:
 *   1. cek parameter ?token= (dari QR) atau ?table= (kode meja diketik manual)
 *   2. simpan meja ke sessionStorage supaya halaman berikutnya tahu
 *   3. tampilkan kategori + produk
 *   4. klik produk -> pilih varian/addon -> masukkan keranjang
 *
 * Halaman ini bisa dibuka tanpa login (tamu QR).
 */

import { api, withQuery } from './api.js';
import * as cartStore from './store.js';
import {
  $,
  $$, 
  escapeHtml,
  rupiah,
  toast,
  modal,
  confirmDialog,
  showLoading,
  showError,
  showEmpty,
} from './ui.js';
import { connect } from './socket.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  table: null,
  qrToken: null,
  categories: [],
  products: [],
  activeCategory: null,
  search: '',
};

// Scope keranjang: per meja agar tidak tercampur antar meja.
function cartScope() {
  return state.table ? state.table.code : 'guest';
}

const params = new URLSearchParams(window.location.search);

// ---------------------------------------------------------------------------
// Inisialisasi
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  await resolveTable();
  await loadCategories();
  await loadProducts();
  updateCartCount();
});

/**
 * Tentukan meja dari QR atau input manual.
 * Tanpa meja, pelanggan tetap bisa melihat menu (mode "guest").
 */
async function resolveTable() {
  const token = params.get('token');
  const code = params.get('table');

  if (!token && !code) {
    showBanner(
      'Anda sedang melihat pratinjau menu tanpa meja. ' +
        'Pindai QR di meja untuk memesan.',
      'info'
    );
    return;
  }

  try {
    if (token) {
      // Endpoint publik, tidak butuh Authorization.
      const response = await fetch(
        `/api/tables/public/resolve?token=${encodeURIComponent(token)}`
      );
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.message || 'QR meja tidak valid.');
      }

      state.table = body.data.table;
      state.qrToken = body.data.qrToken;
    } else {
      // Meja diketik manual: cari lewat endpoint staff bila punya izin.
      const response = await fetch('/api/tables', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('sr_access_token') || ''}`,
        },
      });
      if (response.ok) {
        const body = await response.json();
        const found = (body.data || []).find(
          (table) => table.code.toUpperCase() === code.toUpperCase()
        );
        if (found) state.table = { id: found.id, code: found.code, name: found.name };
      }
    }

    if (state.table) {
      $('#table-info').textContent = `Meja ${state.table.code}`;
      $('#track-link').hidden = false;
      showBanner(`Selamat datang di Meja ${state.table.code}!`, 'success');

      // Dengarkan status pesanan meja ini secara realtime.
      connect({ rooms: [], tableCode: state.table.code });
    }
  } catch (error) {
    showBanner(error.message || 'Gagal membaca QR meja.', 'error');
  }
}

// ---------------------------------------------------------------------------
// Memuat data
// ---------------------------------------------------------------------------

async function loadCategories() {
  try {
    state.categories = await api.get('/menu/categories?active=1', { auth: false });
    renderTabs();
  } catch (error) {
    console.error(error);
  }
}

async function loadProducts() {
  const grid = $('#product-grid');
  showLoading(grid);

  const query = withQuery('/menu/products', {
    available: 1,
    search: state.search || undefined,
    category_id: state.activeCategory || undefined,
    limit: 100,
  });

  try {
    const result = await api.get(query, { auth: false });
    state.products = Array.isArray(result) ? result : result?.items || [];
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
      <button type="button"
              class="tab ${category.id === state.activeCategory ? 'tab--active' : ''}"
              data-category="${category.id ?? ''}">
        ${escapeHtml(category.name)}
      </button>
    `
    )
    .join('');

  $$('.tab', tabs).forEach((tab) => {
    tab.addEventListener('click', () => {
      const value = tab.dataset.category;
      state.activeCategory = value ? Number(value) : null;
      $('#category-title').textContent =
        state.activeCategory
          ? state.categories.find((c) => c.id === state.activeCategory)?.name || 'Menu'
          : 'Semua Menu';
      renderTabs();
      loadProducts();
    });
  });
}

function renderProducts() {
  const grid = $('#product-grid');

  if (state.products.length === 0) {
    showEmpty(grid, 'Tidak ada menu yang cocok dengan pencarian Anda.');
    return;
  }

  grid.innerHTML = state.products
    .map(
      (product) => `
      <button type="button" class="product-card" data-id="${product.id}"
              ${product.stock_status !== 'AVAILABLE' ? 'disabled' : ''}>
        <div class="product-card__body">
          <p class="product-card__name">${escapeHtml(product.name)}</p>
          ${product.description ? `<p class="product-card__desc">${escapeHtml(product.description)}</p>` : ''}
          <p class="product-card__price">${rupiah(product.price)}</p>
          <div class="product-card__meta">
            ${
              product.stock_status !== 'AVAILABLE'
                ? '<span class="badge badge--danger">Habis</span>'
                : product.variants?.length
                ? `<span>${product.variants.length} varian</span>`
                : ''
            }
          </div>
        </div>
      </button>
    `
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
// Dialog pilih varian / addon
// ---------------------------------------------------------------------------

function openProductDialog(product) {
  let selectedVariant = product.variants?.find((v) => v.is_default) || product.variants?.[0] || null;
  const selectedAddons = new Map();

  const hasChoices = (product.variants?.length || 0) > 0 || (product.addons?.length || 0) > 0;

  if (!hasChoices) {
    addToCart(product, null, []);
    return;
  }

  const dialog = modal({
    title: product.name,
    content: `
      ${product.description ? `<p class="muted">${escapeHtml(product.description)}</p>` : ''}

      ${
        product.variants?.length
          ? `
        <div class="field" style="margin-bottom:1rem;">
          <span class="label">Pilih varian</span>
          <div class="pay-methods" id="variant-list">
            ${product.variants
              .map(
                (variant) => `
              <button type="button" class="pay-method ${variant === selectedVariant ? 'pay-method--active' : ''}"
                      data-variant="${variant.id}"
                      data-price="${variant.price ?? product.price}"
                      data-name="${escapeHtml(variant.name)}">
                <span>${escapeHtml(variant.name)}</span>
                <span class="tiny muted">${rupiah(variant.price ?? product.price)}</span>
              </button>
            `
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
          <span class="label">Tambahkan (opsional)</span>
          <div class="stack stack--sm" id="addon-list">
            ${product.addons
              .map(
                (addon) => `
              <label class="checkbox">
                <input type="checkbox" data-addon="${addon.id}"
                       data-name="${escapeHtml(addon.name)}" data-price="${addon.price}" />
                <span>${escapeHtml(addon.name)}
                  <span class="muted tiny">+ ${rupiah(addon.price)}</span>
                </span>
              </label>
            `
              )
              .join('')}
          </div>
        </div>`
          : ''
      }

      <div class="field">
        <label class="label" for="product-qty">Jumlah</label>
        <div class="qty-control">
          <button type="button" data-qty-action="dec">−</button>
          <input type="number" id="product-qty" value="1" min="1" max="99" />
          <button type="button" data-qty-action="inc">+</button>
        </div>
      </div>
    `,
    footer: `
      <button type="button" class="btn btn--ghost" data-close>Batal</button>
      <button type="button" class="btn btn--primary" data-add>Tambah ke Keranjang</button>
    `,
  });

  const root = dialog.element;

  // Pilih varian
  $$('[data-variant]', root).forEach((button) => {
    button.addEventListener('click', () => {
      $$('[data-variant]', root).forEach((b) => b.classList.remove('pay-method--active'));
      button.classList.add('pay-method--active');

      const id = Number(button.dataset.variant);
      selectedVariant = {
        id,
        name: button.dataset.name,
        price: Number(button.dataset.price),
      };
    });
  });

  // Kontrol jumlah
  const qtyInput = root.querySelector('#product-qty');
  root.querySelector('[data-qty-action="dec"]').addEventListener('click', () => {
    qtyInput.value = Math.max(1, Number(qtyInput.value) - 1);
  });
  root.querySelector('[data-qty-action="inc"]').addEventListener('click', () => {
    qtyInput.value = Math.min(99, Number(qtyInput.value) + 1);
  });

  // Tambah ke keranjang
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

    addToCart(product, selectedVariant, addons, quantity);
    dialog.close();
  });
}

function addToCart(product, variant, addons, quantity = 1) {
  cartStore.addItem(cartScope(), product, { variant, addons, quantity });
  updateCartCount();
  toast(`${product.name} ditambahkan ke keranjang.`, 'success', 2000);
}

// ---------------------------------------------------------------------------
// Utilitas tampilan
// ---------------------------------------------------------------------------

function updateCartCount() {
  $('#cart-count').textContent = cartStore.totalQuantity(cartScope());
}

function showBanner(message, type) {
  const banner = $('#banner');
  const variantClass = {
    info: 'card',
    success: 'card',
    error: 'card',
  }[type];

  banner.innerHTML = `
    <div class="${variantClass}" style="padding: 0.75rem 1rem; border-left: 4px solid var(--${type === 'error' ? 'danger' : type === 'success' ? 'success' : 'info'});">
      ${escapeHtml(message)}
    </div>
  `;
}

// Pencarian
$('#search-input').addEventListener('input', (event) => {
  state.search = event.target.value.trim();
  loadProducts();
});

// Navigasi keranjang
$('#cart-button').addEventListener('click', () => {
  if (!state.table) {
    toast('Scan QR meja atau masukkan kode meja untuk memesan.', 'warning');
    return;
  }
  window.location.href = `/cart.html${state.qrToken ? `?token=${state.qrToken}` : `?table=${state.table.code}`}`;
});

$('#track-link').addEventListener('click', () => {
  window.location.href = `/order.html${state.qrToken ? `?token=${state.qrToken}` : `?table=${state.table.code}`}`;
});