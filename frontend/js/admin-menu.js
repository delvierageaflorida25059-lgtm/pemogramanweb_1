/**
 * Halaman pengelolaan menu: kategori dan produk.
 *
 * Modul ini memakai endpoint yang sama dengan halaman kasir/pelanggan,
 * jadi perubahan harga langsung terlihat di mana pun tanpa perlu sinkronisasi.
 */

import { api, tokenStore, withQuery } from './api.js';
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
  requireLogin,
  withBusyButton,
  debounce,
} from './ui.js';

if (!requireLogin({ requiredPermissions: ['category.view'] })) {
  throw new Error('Akses ditolak');
}

const state = {
  categories: [],
  products: [],
  page: 1,
  limit: 20,
  search: '',
  categoryId: '',
  canManage: false,
  canDelete: false,
};

document.addEventListener('DOMContentLoaded', async () => {
  $('#user-label').textContent = tokenStore.user?.name || '';

  const permissions = tokenStore.user?.permissions || [];
  const isAdmin = (tokenStore.user?.roles || []).includes('ADMIN');
  state.canManage = isAdmin || permissions.includes('product.manage');
  state.canDelete = isAdmin || permissions.includes('product.delete');

  if (!state.canManage) {
    $('#new-category-button').hidden = true;
    $('#new-product-button').hidden = true;
  }

  $('#logout-button').addEventListener('click', logout);
  $('#new-category-button').addEventListener('click', () => openCategoryForm());
  $('#new-product-button').addEventListener('click', () => openProductForm());
  $('#product-search').addEventListener(
    'input',
    debounce((event) => {
      state.search = event.target.value.trim();
      state.page = 1;
      loadProducts();
    }, 300)
  );
  $('#category-filter').addEventListener('change', (event) => {
    state.categoryId = event.target.value;
    state.page = 1;
    loadProducts();
  });

  // Tab switching
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach((t) => t.classList.remove('tab--active'));
      $$('.tab-panel').forEach((p) => p.classList.remove('tab-panel--active'));
      tab.classList.add('tab--active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('tab-panel--active');
    });
  });

  await loadCategories();
  await loadProducts();
});

// ---------------------------------------------------------------------------
// Kategori
// ---------------------------------------------------------------------------

async function loadCategories() {
  const tbody = $('#category-tbody');
  showLoading(tbody, 'Memuat kategori...');

  try {
    state.categories = await api.get('/categories');
    renderCategories();
    renderCategoryFilter();
  } catch (error) {
    showError(tbody, error.message, loadCategories);
  }
}

function renderCategories() {
  const tbody = $('#category-tbody');

  if (state.categories.length === 0) {
    showEmpty(tbody, 'Belum ada kategori. Buat kategori pertama.');
    return;
  }

  tbody.innerHTML = state.categories
    .map(
      (category) => `
      <tr>
        <td data-label="Nama"><strong>${escapeHtml(category.name)}</strong></td>
        <td data-label="Deskripsi" class="muted small">${escapeHtml(category.description || '-')}</td>
        <td data-label="Produk" class="num">${category.product_count ?? 0}</td>
        <td data-label="Status">
          <span class="badge badge--${category.is_active ? 'success' : 'neutral'}">
            ${category.is_active ? 'Aktif' : 'Nonaktif'}
          </span>
        </td>
        <td data-label="Aksi" class="table__actions-cell">
          <div class="table__actions">
            ${
              state.canManage
                ? `<button type="button" class="btn btn--outline btn--small"
                     data-edit-cat="${category.id}">Ubah</button>
                   <button type="button" class="btn btn--danger btn--small"
                     data-delete-cat="${category.id}">Hapus</button>`
                : ''
            }
          </div>
        </td>
      </tr>`
    )
    .join('');

  $$('[data-edit-cat]', tbody).forEach((button) => {
    button.addEventListener('click', () => {
      const category = state.categories.find((c) => c.id === Number(button.dataset.editCat));
      openCategoryForm(category);
    });
  });

  $$('[data-delete-cat]', tbody).forEach((button) => {
    button.addEventListener('click', () => deleteCategory(Number(button.dataset.deleteCat)));
  });
}

function renderCategoryFilter() {
  const select = $('#category-filter');
  select.innerHTML =
    '<option value="">Semua kategori</option>' +
    state.categories
      .map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`)
      .join('');
}

function openCategoryForm(category = null) {
  const isEdit = Boolean(category);

  const dialog = modal({
    title: isEdit ? 'Ubah Kategori' : 'Tambah Kategori',
    size: 'sm',
    content: `
      <div class="field">
        <label class="label" for="cat-name">Nama <span class="required">*</span></label>
        <input class="input" type="text" id="cat-name" maxlength="100"
               value="${escapeHtml(category?.name || '')}" />
      </div>
      <div class="field">
        <label class="label" for="cat-desc">Deskripsi</label>
        <textarea class="textarea" id="cat-desc" maxlength="255">${escapeHtml(category?.description || '')}</textarea>
      </div>
      <div class="field">
        <label class="label" for="cat-order">Urutan tampil</label>
        <input class="input" type="number" id="cat-order" min="0"
               value="${category?.sort_order ?? 0}" />
      </div>
      <label class="checkbox">
        <input type="checkbox" id="cat-active" ${category?.is_active !== false ? 'checked' : ''} />
        <span>Aktif dan tampil di menu pelanggan</span>
      </label>
    `,
    footer: `
      <button type="button" class="btn btn--ghost" data-close>Batal</button>
      <button type="button" class="btn btn--primary" data-save>Simpan</button>
    `,
  });

  dialog.element.querySelector('[data-save]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const payload = {
      name: $('#cat-name').value.trim(),
      description: $('#cat-desc').value.trim(),
      sort_order: Number($('#cat-order').value) || 0,
      is_active: $('#cat-active').checked,
    };

    await withBusyButton(
      button,
      (async () => {
        try {
          if (isEdit) {
            await api.put(`/categories/${category.id}`, payload);
            toast('Kategori diperbarui.', 'success');
          } else {
            await api.post('/categories', payload);
            toast('Kategori dibuat.', 'success');
          }
          dialog.close();
          loadCategories();
        } catch (error) {
          toast(error.message, 'error');
        }
      })(),
      'Menyimpan...'
    );
  });
}

async function deleteCategory(categoryId) {
  const category = state.categories.find((c) => c.id === categoryId);

  const confirmed = await confirmDialog(
    'Hapus kategori?',
    `Kategori "${category.name}" akan dihapus. Kategori yang masih punya produk tidak bisa dihapus.`,
    { confirmLabel: 'Hapus', danger: true }
  );
  if (!confirmed) return;

  try {
    await api.delete(`/categories/${categoryId}`);
    toast('Kategori dihapus.', 'success');
    loadCategories();
  } catch (error) {
    toast(error.message, 'error', 5000);
  }
}

// ---------------------------------------------------------------------------
// Produk
// ---------------------------------------------------------------------------

async function loadProducts() {
  const tbody = $('#product-tbody');
  showLoading(tbody, 'Memuat produk...');

  try {
    const result = await api.get(
      withQuery('/products', {
        page: state.page,
        limit: state.limit,
        search: state.search || undefined,
        category_id: state.categoryId || undefined,
      })
    );

    state.products = result.items || [];
    renderProducts(result.meta || {});
  } catch (error) {
    showError(tbody, error.message, loadProducts);
  }
}

function renderProducts(meta = {}) {
  const tbody = $('#product-tbody');

  if (state.products.length === 0) {
    showEmpty(tbody, 'Tidak ada produk yang cocok.');
    $('#product-pagination').innerHTML = '';
    return;
  }

  tbody.innerHTML = state.products
    .map(
      (product) => `
      <tr>
        <td data-label="Kode" class="mono small">${escapeHtml(product.code)}</td>
        <td data-label="Nama">
          <strong>${escapeHtml(product.name)}</strong>
          ${product.description ? `<div class="tiny muted">${escapeHtml(product.description)}</div>` : ''}
        </td>
        <td data-label="Kategori" class="small">${escapeHtml(product.category_name)}</td>
        <td data-label="Harga" class="num">${rupiah(product.price)}</td>
        <td data-label="Varian" class="num">${(product.variants || []).length}</td>
        <td data-label="Status">
          ${
            !product.is_active
              ? '<span class="badge badge--neutral">Nonaktif</span>'
              : product.stock_status === 'AVAILABLE'
              ? '<span class="badge badge--success">Tersedia</span>'
              : '<span class="badge badge--danger">Habis</span>'
          }
        </td>
        <td data-label="Aksi" class="table__actions-cell">
          <div class="table__actions">
            ${
              state.canManage
                ? `<button type="button" class="btn btn--outline btn--small"
                     data-edit-prod="${product.id}">Ubah</button>
                   <button type="button" class="btn ${product.stock_status === 'AVAILABLE' ? 'btn--outline' : 'btn--success'} btn--small"
                     data-toggle="${product.id}" data-status="${product.stock_status}">
                     ${product.stock_status === 'AVAILABLE' ? 'Tandai Habis' : 'Tandai Ada'}
                   </button>`
                : ''
            }
            ${
              state.canDelete && product.is_active
                ? `<button type="button" class="btn btn--danger btn--small"
                     data-delete-prod="${product.id}">Hapus</button>`
                : ''
            }
          </div>
        </td>
      </tr>`
    )
    .join('');

  $$('[data-edit-prod]', tbody).forEach((button) => {
    button.addEventListener('click', async () => {
      const id = Number(button.dataset.editProd);
      try {
        const product = await api.get(`/products/${id}`);
        openProductForm(product);
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  });

  $$('[data-toggle]', tbody).forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.dataset.toggle);
      const next = button.dataset.status === 'AVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE';
      toggleStock(id, next);
    });
  });

  $$('[data-delete-prod]', tbody).forEach((button) => {
    button.addEventListener('click', () => deleteProduct(Number(button.dataset.deleteProd)));
  });

  renderPagination(meta);
}

function renderPagination(meta) {
  const container = $('#product-pagination');

  if (!meta.total) {
    container.innerHTML = '';
    return;
  }

  const { page, totalPages, total } = meta;

  container.innerHTML = `
    <span>Halaman ${page} dari ${totalPages} (total ${total} produk)</span>
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
      loadProducts();
    });
  }
  if (next && !next.disabled) {
    next.addEventListener('click', () => {
      state.page += 1;
      loadProducts();
    });
  }
}

async function toggleStock(productId, stockStatus) {
  try {
    await api.patch(`/products/${productId}/stock-status`, { stock_status: stockStatus });
    toast(`Status stok diubah ke ${stockStatus}.`, 'success');
    loadProducts();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function deleteProduct(productId) {
  const product = state.products.find((p) => p.id === productId);

  const confirmed = await confirmDialog(
    'Hapus produk?',
    `Produk "${product.name}" akan dinonaktifkan dan hilang dari menu. Riwayat transaksi lama tetap tersimpan.`,
    { confirmLabel: 'Hapus', danger: true }
  );
  if (!confirmed) return;

  try {
    await api.delete(`/products/${productId}`);
    toast('Produk dinonaktifkan.', 'success');
    loadProducts();
  } catch (error) {
    toast(error.message, 'error');
  }
}

/** Dialog tambah / ubah produk, termasuk varian dan addon. */
function openProductForm(product = null) {
  const isEdit = Boolean(product);

  const categoryOptions = state.categories
    .map(
      (category) => `
      <option value="${category.id}" ${product?.category_id === category.id ? 'selected' : ''}>
        ${escapeHtml(category.name)}
      </option>`
    )
    .join('');

  const dialog = modal({
    title: isEdit ? `Ubah Produk: ${product.name}` : 'Tambah Produk Baru',
    size: 'lg',
    content: `
      <div class="form-row">
        <div class="field">
          <label class="label" for="prod-code">Kode <span class="required">*</span></label>
          <input class="input" type="text" id="prod-code" maxlength="30"
                 value="${escapeHtml(product?.code || '')}" />
        </div>
        <div class="field">
          <label class="label" for="prod-category">Kategori <span class="required">*</span></label>
          <select class="select" id="prod-category">${categoryOptions}</select>
        </div>
      </div>

      <div class="field">
        <label class="label" for="prod-name">Nama Produk <span class="required">*</span></label>
        <input class="input" type="text" id="prod-name" maxlength="150"
               value="${escapeHtml(product?.name || '')}" />
      </div>

      <div class="field">
        <label class="label" for="prod-desc">Deskripsi</label>
        <textarea class="textarea" id="prod-desc" maxlength="2000">${escapeHtml(product?.description || '')}</textarea>
      </div>

      <div class="form-row">
        <div class="field">
          <label class="label" for="prod-price">Harga (Rp) <span class="required">*</span></label>
          <input class="input" type="number" id="prod-price" min="0" step="100"
                 value="${product?.price ?? 0}" />
        </div>
        <div class="field">
          <label class="label" for="prod-order">Urutan tampil</label>
          <input class="input" type="number" id="prod-order" min="0"
                 value="${product?.sort_order ?? 0}" />
        </div>
      </div>

      <label class="checkbox" style="margin-bottom: 1rem;">
        <input type="checkbox" id="prod-active" ${product?.is_active !== false ? 'checked' : ''} />
        <span>Tampilkan di menu</span>
      </label>

      <div class="divider"></div>

      <div class="section__header">
        <h3 style="margin: 0;">Varian</h3>
        <button type="button" class="btn btn--outline btn--small" id="add-variant">+ Varian</button>
      </div>
      <div id="variant-list" class="stack stack--sm"></div>

      <div class="divider"></div>

      <div class="section__header">
        <h3 style="margin: 0;">Addon</h3>
        <button type="button" class="btn btn--outline btn--small" id="add-addon">+ Addon</button>
      </div>
      <div id="addon-list" class="stack stack--sm"></div>
    `,
    footer: `
      <button type="button" class="btn btn--ghost" data-close>Batal</button>
      <button type="button" class="btn btn--primary" data-save>Simpan Produk</button>
    `,
  });

  // Baris varian dan addon dikumpulkan di array lalu dikirim sebagai array.
  let variants = (product?.variants || []).map((variant) => ({ ...variant }));
  let addons = (product?.addons || []).map((addon) => ({ ...addon }));

  const variantList = dialog.element.querySelector('#variant-list');
  const addonList = dialog.element.querySelector('#addon-list');

  function renderVariants() {
    variantList.innerHTML =
      variants.length === 0
        ? '<p class="muted small">Belum ada varian. Produk tanpa varian memakai harga utama.</p>'
        : variants
            .map(
              (variant, index) => `
      <div class="row" data-variant-row="${index}">
        <input class="input" type="text" placeholder="Nama varian" style="flex:2;"
               data-variant-name="${index}" value="${escapeHtml(variant.name || '')}" />
        <input class="input" type="number" placeholder="Harga (kosong = harga utama)" style="flex:1;"
               data-variant-price="${index}" value="${variant.price ?? ''}" />
        <button type="button" class="btn btn--danger btn--small" data-remove-variant="${index}">×</button>
      </div>`
            )
            .join('');

    $$('[data-remove-variant]', variantList).forEach((button) => {
      button.addEventListener('click', () => {
        variants.splice(Number(button.dataset.removeVariant), 1);
        renderVariants();
      });
    });
  }

  function renderAddons() {
    addonList.innerHTML =
      addons.length === 0
        ? '<p class="muted small">Belum ada addon.</p>'
        : addons
            .map(
              (addon, index) => `
      <div class="row" data-addon-row="${index}">
        <input class="input" type="text" placeholder="Nama addon" style="flex:2;"
               data-addon-name="${index}" value="${escapeHtml(addon.name || '')}" />
        <input class="input" type="number" placeholder="Harga" style="flex:1;"
               data-addon-price="${index}" value="${addon.price ?? 0}" />
        <button type="button" class="btn btn--danger btn--small" data-remove-addon="${index}">×</button>
      </div>`
            )
            .join('');

    $$('[data-remove-addon]', addonList).forEach((button) => {
      button.addEventListener('click', () => {
        addons.splice(Number(button.dataset.removeAddon), 1);
        renderAddons();
      });
    });
  }

  dialog.element.querySelector('#add-variant').addEventListener('click', () => {
    variants.push({ name: '', price: null });
    renderVariants();
  });

  dialog.element.querySelector('#add-addon').addEventListener('click', () => {
    addons.push({ name: '', price: 0 });
    renderAddons();
  });

  renderVariants();
  renderAddons();

  dialog.element.querySelector('[data-save]').addEventListener('click', async (event) => {
    const button = event.currentTarget;

    // Kumpulkan input varian & addon yang tampil di form.
    variants.forEach((variant, index) => {
      const nameInput = variantList.querySelector(`[data-variant-name="${index}"]`);
      const priceInput = variantList.querySelector(`[data-variant-price="${index}"]`);
      if (nameInput) variant.name = nameInput.value.trim();
      if (priceInput) {
        variant.price = priceInput.value === '' ? null : Number(priceInput.value);
      }
    });

    addons.forEach((addon, index) => {
      const nameInput = addonList.querySelector(`[data-addon-name="${index}"]`);
      const priceInput = addonList.querySelector(`[data-addon-price="${index}"]`);
      if (nameInput) addon.name = nameInput.value.trim();
      if (priceInput) addon.price = Number(priceInput.value) || 0;
    });

    const payload = {
      code: $('#prod-code').value.trim(),
      category_id: Number($('#prod-category').value),
      name: $('#prod-name').value.trim(),
      description: $('#prod-desc').value.trim(),
      price: Number($('#prod-price').value) || 0,
      sort_order: Number($('#prod-order').value) || 0,
      is_active: $('#prod-active').checked,
    };

    if (isEdit) {
      await withBusyButton(
        button,
        (async () => {
          try {
            await api.put(`/products/${product.id}`, payload);

            // Sinkronkan varian: hapus yang tidak ada lagi, tambah yang baru.
            await syncVariants(product.id, variants);
            await syncAddons(product.id, addons);

            toast('Produk diperbarui.', 'success');
            dialog.close();
            loadProducts();
          } catch (error) {
            toast(error.message, 'error');
          }
        })(),
        'Menyimpan...'
      );
    } else {
      // Produk baru dibuat lengkap dengan varian & addon dalam satu request.
      payload.variants = variants.filter((v) => v.name).map((v) => ({
        name: v.name,
        price: v.price,
      }));

      await withBusyButton(
        button,
        (async () => {
          try {
            const created = await api.post('/products', payload);

            for (const addon of addons.filter((a) => a.name)) {
              await api.post(`/products/${created.id}/addons`, {
                name: addon.name,
                price: addon.price,
              });
            }

            toast('Produk dibuat.', 'success');
            dialog.close();
            loadProducts();
          } catch (error) {
            toast(error.message, 'error');
          }
        })(),
        'Menyimpan...'
      );
    }
  });

  /**
   * Sinkronkan daftar varian dengan yang tampil di form: tambah yang baru,
   * perbarui yang berubah, hapus yang tidak ada lagi.
   */
  async function syncVariants(productId, formVariants) {
    const existing = product.variants || [];
    const filled = formVariants.filter((variant) => variant.name);

    // Hapus varian yang tidak ada di form.
    for (const variant of existing) {
      if (!filled.some((entry) => entry.id === variant.id)) {
        await api.delete(`/products/${productId}/variants/${variant.id}`);
      }
    }

    // Tambah baru / perbarui harga.
    for (const variant of filled) {
      if (variant.id) {
        await api.put(`/products/${productId}/variants/${variant.id}`, {
          name: variant.name,
          price: variant.price,
        });
      } else {
        await api.post(`/products/${productId}/variants`, {
          name: variant.name,
          price: variant.price,
        });
      }
    }
  }

  /** Sama seperti syncVariants, untuk addon. */
  async function syncAddons(productId, formAddons) {
    const existing = product.addons || [];
    const filled = formAddons.filter((addon) => addon.name);

    for (const addon of existing) {
      if (!filled.some((entry) => entry.id === addon.id)) {
        await api.delete(`/products/${productId}/addons/${addon.id}`);
      }
    }

    for (const addon of filled) {
      if (addon.id) {
        await api.put(`/products/${productId}/addons/${addon.id}`, {
          name: addon.name,
          price: addon.price,
        });
      } else {
        await api.post(`/products/${productId}/addons`, {
          name: addon.name,
          price: addon.price,
        });
      }
    }
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