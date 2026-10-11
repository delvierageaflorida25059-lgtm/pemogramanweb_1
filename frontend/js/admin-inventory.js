/**
 * Halaman Inventory: bahan baku, resep/BOM, jurnal mutasi, dan stock opname.
 *
 * Semua perubahan stok TIDAK dilakukan langsung dari halaman ini lewat kolom
 * stok. Kolom stok sengaja tidak bisa diedit karena setiap perubahan harus
 * tercatat di jurnal inventory_transactions. Tombol yang tersedia adalah
 * "Barang Masuk" (PURCHASE) dan "Sesuaikan" (ADJUSTMENT), keduanya membuat
 * entri jurnal otomatis.
 */

import { api, tokenStore, withQuery } from './api.js';
import {
  $,
  $$,
  escapeHtml,
  rupiah,
  number,
  dateTime,
  toast,
  modal,
  confirmDialog,
  showLoading,
  showError,
  showEmpty,
  requireLogin,
  withBusyButton,
} from './ui.js';
import { connect, on, isConnected } from './socket.js';

if (!requireLogin({ requiredPermissions: ['inventory.view'] })) {
  throw new Error('Akses ditolak');
}

const UNITS = ['gram', 'kg', 'ml', 'liter', 'pcs', 'pack', 'bottle', 'cans'];

const TYPE_BADGE = {
  PURCHASE: 'success',
  SALE: 'info',
  ADJUSTMENT: 'warning',
  OPNAME: 'neutral',
  WASTE: 'danger',
  VOID: 'neutral',
  RETURN: 'info',
};

const state = {
  ingredients: [],
  recipes: [],
  products: [],
  movements: [],
  opnames: [],
  summary: null,
  search: '',
  lowStockOnly: false,
  movementPage: 1,
  movementType: '',
  movementFrom: '',
  movementTo: '',
  canManage: false,
  openOpnameId: null,
};

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  $('#user-label').textContent = tokenStore.user?.name || '';

  const permissions = tokenStore.user?.permissions || [];
  const isAdmin = (tokenStore.user?.roles || []).includes('ADMIN');
  state.canManage = isAdmin || permissions.includes('inventory.manage');

  if (!state.canManage) {
    $('#new-ingredient-button').hidden = true;
    $('#new-recipe-button').hidden = true;
    $('#new-opname-button').hidden = true;
    $('#receive-button').hidden = true;
  }

  wireTabs();
  wireEvents();
  startSocket();

  await Promise.all([loadSummary(), loadIngredients(), loadProducts(), loadRecipes()]);
  await Promise.all([loadMovements(), loadOpnames()]);
});

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------

function startSocket() {
  connect({ rooms: ['inventory'] });

  // Stok berubah karena order dari kasir atau dapur.
  on('stock:changed', () => {
    loadIngredients();
    loadSummary();
  });

  on('stock:low', () => {
    loadIngredients();
    loadSummary();
  });

  on('opname:approved', () => {
    loadOpnames();
    loadIngredients();
    loadSummary();
  });

  setInterval(() => {
    const indicator = $('#socket-indicator');
    if (indicator) {
      indicator.style.background = isConnected() ? 'var(--color-success)' : 'var(--color-danger)';
    }
  }, 2000);
}

// ---------------------------------------------------------------------------
// Ringkasan
// ---------------------------------------------------------------------------

async function loadSummary() {
  try {
    state.summary = await api.get('/inventory/summary');
    renderStats();
  } catch (error) {
    console.error(error);
  }
}

function renderStats() {
  const data = state.summary;
  if (!data) return;

  const todayTypes = Object.entries(data.movementsToday || {});
  const todayTotal = todayTypes.reduce(
    (sum, [, count]) => sum + count,
    0
  );

  $('#stats').innerHTML = `
    <div class="stat stat--primary">
      <span class="stat__label">Jenis Bahan</span>
      <div class="stat__value">${number(data.totalIngredients)}</div>
    </div>

    <div class="stat stat--success">
      <span class="stat__label">Nilai Stok</span>
      <div class="stat__value">${rupiah(data.totalValue)}</div>
      <div class="stat__hint">stok x harga satuan</div>
    </div>

    <div class="stat ${data.lowStockCount > 0 ? 'stat--danger' : ''}">
      <span class="stat__label">Perlu Dibeli</span>
      <div class="stat__value">${number(data.lowStockCount)}</div>
      <div class="stat__hint">stok di bawah minimum</div>
    </div>

    <div class="stat">
      <span class="stat__label">Mutasi Hari Ini</span>
      <div class="stat__value">${number(todayTotal)}</div>
      <div class="stat__hint">
        ${
          todayTypes.length > 0
            ? todayTypes.map(([type, count]) => `${typeLabel(type)}: ${count}`).join(', ')
            : 'belum ada'
        }
      </div>
    </div>
  `;
}

function typeLabel(type) {
  const labels = {
    PURCHASE: 'Pembelian',
    SALE: 'Pemakaian',
    ADJUSTMENT: 'Penyesuaian',
    OPNAME: 'Opname',
    WASTE: 'Rusak',
    VOID: 'Pengembalian',
    RETURN: 'Retur',
  };
  return labels[type] || type;
}

// ---------------------------------------------------------------------------
// Bahan baku
// ---------------------------------------------------------------------------

async function loadIngredients() {
  const tbody = $('#ingredient-tbody');
  showLoading(tbody, 'Memuat bahan baku...');

  try {
    const result = await api.get(
      withQuery('/inventory/ingredients', {
        search: state.search || undefined,
        low_stock: state.lowStockOnly ? '1' : undefined,
        limit: 100,
      })
    );

    state.ingredients = result.items || [];
    renderIngredients();
  } catch (error) {
    showError(tbody, error.message, loadIngredients);
  }
}

function renderIngredients() {
  const tbody = $('#ingredient-tbody');

  if (state.ingredients.length === 0) {
    showEmpty(tbody, 'Belum ada bahan baku.');
    return;
  }

  tbody.innerHTML = state.ingredients
    .map(
      (item) => `
      <tr class="${item.isLowStock ? '' : ''}">
        <td data-label="Kode" class="mono small">${escapeHtml(item.code)}</td>
        <td data-label="Nama"><strong>${escapeHtml(item.name)}</strong></td>
        <td data-label="Satuan"><span class="badge badge--neutral">${escapeHtml(item.unit)}</span></td>
        <td data-label="Stok" class="num">
          <strong class="${item.isLowStock ? 'text-danger' : ''}">
            ${number(item.stock, 3)} ${escapeHtml(item.unit)}
          </strong>
        </td>
        <td data-label="Minimum" class="num muted">${number(item.minimumStock, 3)}</td>
        <td data-label="Nilai" class="num">${rupiah(item.stock * item.unitPrice)}</td>
        <td data-label="Status">
          ${
            !item.isActive
              ? '<span class="badge badge--neutral">Nonaktif</span>'
              : item.isLowStock
              ? '<span class="badge badge--danger">Menipis</span>'
              : '<span class="badge badge--success">Aman</span>'
          }
        </td>
        <td data-label="Aksi" class="table__actions-cell">
          <div class="table__actions">
            ${
              state.canManage
                ? `<button type="button" class="btn btn--outline btn--small"
                     data-adjust="${item.id}">Sesuaikan</button>
                   <button type="button" class="btn btn--ghost btn--small"
                     data-edit="${item.id}">Ubah</button>`
                : ''
            }
          </div>
        </td>
      </tr>`
    )
    .join('');

  $$('[data-adjust]', tbody).forEach((button) => {
    button.addEventListener('click', () => {
      const item = state.ingredients.find((i) => i.id === Number(button.dataset.adjust));
      openAdjustDialog(item);
    });
  });

  $$('[data-edit]', tbody).forEach((button) => {
    button.addEventListener('click', () => {
      const item = state.ingredients.find((i) => i.id === Number(button.dataset.edit));
      openIngredientForm(item);
    });
  });
}

function openIngredientForm(ingredient = null) {
  const isEdit = Boolean(ingredient);

  const dialog = modal({
    title: isEdit ? `Ubah ${ingredient.name}` : 'Tambah Bahan Baku',
    size: 'sm',
    content: `
      <div class="form-row">
        <div class="field">
          <label class="label" for="ing-code">Kode <span class="required">*</span></label>
          <input class="input" type="text" id="ing-code" maxlength="30"
                 value="${escapeHtml(ingredient?.code || '')}" placeholder="BHN-027" />
        </div>
        <div class="field">
          <label class="label" for="ing-unit">Satuan <span class="required">*</span></label>
          <select class="select" id="ing-unit">
            ${UNITS.map(
              (unit) =>
                `<option value="${unit}" ${ingredient?.unit === unit ? 'selected' : ''}>${unit}</option>`
            ).join('')}
          </select>
        </div>
      </div>

      <div class="field">
        <label class="label" for="ing-name">Nama <span class="required">*</span></label>
        <input class="input" type="text" id="ing-name" maxlength="150"
               value="${escapeHtml(ingredient?.name || '')}" />
      </div>

      <div class="form-row">
        <div class="field">
          <label class="label" for="ing-min">Stok Minimum</label>
          <input class="input" type="number" id="ing-min" min="0" step="0.001"
                 value="${ingredient?.minimumStock ?? 0}" />
        </div>
        <div class="field">
          <label class="label" for="ing-price">Harga per ${escapeHtml(ingredient?.unit || 'satuan')}</label>
          <input class="input" type="number" id="ing-price" min="0" step="100"
                 value="${ingredient?.unitPrice ?? 0}" />
        </div>
      </div>

      ${
        isEdit
          ? `<div class="alert alert--info">
               Stok saat ini <strong>${number(ingredient.stock, 3)} ${escapeHtml(ingredient.unit)}</strong>
               tidak bisa diubah dari sini. Gunakan "Barang Masuk" atau "Sesuaikan"
               supaya perubahan tercatat di jurnal mutasi.
             </div>`
          : `<div class="field">
               <label class="label" for="ing-stock">Stok Awal</label>
               <input class="input" type="number" id="ing-stock" min="0" step="0.001" value="0" />
               <p class="field__hint">Stok awal otomatis dicatat sebagai mutasi PEMBELIAN.</p>
             </div>`
      }
    `,
    footer: `
      <button type="button" class="btn btn--ghost" data-close>Batal</button>
      <button type="button" class="btn btn--primary" data-save>Simpan</button>
    `,
  });

  dialog.element.querySelector('[data-save]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const payload = {
      code: $('#ing-code').value.trim(),
      name: $('#ing-name').value.trim(),
      unit: $('#ing-unit').value,
      minimum_stock: Number($('#ing-min').value) || 0,
      unit_price: Number($('#ing-price').value) || 0,
    };

    if (!isEdit) payload.stock = Number($('#ing-stock').value) || 0;

    await withBusyButton(
      button,
      (async () => {
        try {
          if (isEdit) await api.put(`/inventory/ingredients/${ingredient.id}`, payload);
          else await api.post('/inventory/ingredients', payload);

          toast('Bahan baku tersimpan.', 'success');
          dialog.close();
          await Promise.all([loadIngredients(), loadSummary()]);
        } catch (error) {
          toast(error.message, 'error', 5000);
        }
      })(),
      'Menyimpan...'
    );
  });
}

/** Dialog penyesuaian stok manual (rusak, koreksi, kadaluarsa). */
function openAdjustDialog(ingredient) {
  const dialog = modal({
    title: `Sesuaikan Stok: ${ingredient.name}`,
    size: 'sm',
    content: `
      <div class="alert alert--info" style="margin-bottom: 1rem;">
        Stok saat ini <strong>${number(ingredient.stock, 3)} ${escapeHtml(ingredient.unit)}</strong>
      </div>

      <div class="field">
        <span class="label">Arah Penyesuaian</span>
        <div class="payment-methods" id="direction-list">
          <button type="button" class="payment-method payment-method--active" data-direction="OUT">
            Berkurang
          </button>
          <button type="button" class="payment-method" data-direction="IN">
            Bertambah
          </button>
        </div>
      </div>

      <div class="field" style="margin-top: 1rem;">
        <label class="label" for="adjust-qty">Jumlah (${escapeHtml(ingredient.unit)})</label>
        <input class="input" type="number" id="adjust-qty" min="0" step="0.001" value="1" />
      </div>

      <div class="field">
        <label class="label" for="adjust-note">Alasan</label>
        <input class="input" type="text" id="adjust-note" maxlength="255"
               placeholder="Contoh: barang rusak / koreksi hitung" />
      </div>
    `,
    footer: `
      <button type="button" class="btn btn--ghost" data-close>Batal</button>
      <button type="button" class="btn btn--primary" data-save>Simpan Penyesuaian</button>
    `,
  });

  const root = dialog.element;
  let direction = 'OUT';

  $$('[data-direction]', root).forEach((button) => {
    button.addEventListener('click', () => {
      $$('[data-direction]', root).forEach((b) => b.classList.remove('payment-method--active'));
      button.classList.add('payment-method--active');
      direction = button.dataset.direction;
    });
  });

  root.querySelector('[data-save]').addEventListener('click', async (event) => {
    const button = event.currentTarget;

    await withBusyButton(
      button,
      (async () => {
        try {
          const result = await api.post('/inventory/adjustment', {
            ingredient_id: ingredient.id,
            direction,
            quantity: Number($('#adjust-qty').value),
            note: $('#adjust-note').value.trim(),
          });

          toast(
            `Stok ${result.name} menjadi ${number(result.stockAfter, 3)} ${result.unit}.`,
            'success'
          );
          dialog.close();
          await Promise.all([loadIngredients(), loadSummary(), loadMovements()]);
        } catch (error) {
          toast(error.message, 'error', 5000);
        }
      })(),
      'Menyimpan...'
    );
  });
}

/** Dialog barang masuk dari supplier. */
function openReceiveDialog() {
  if (state.ingredients.length === 0) {
    toast('Buat bahan baku terlebih dahulu.', 'warning');
    return;
  }

  const dialog = modal({
    title: 'Barang Masuk dari Supplier',
    size: 'sm',
    content: `
      <div class="field">
        <label class="label" for="receive-ing">Bahan Baku</label>
        <select class="select" id="receive-ing">
          ${state.ingredients
            .filter((item) => item.isActive)
            .map((item) => `<option value="${item.id}">${escapeHtml(item.code)} - ${escapeHtml(item.name)}</option>`)
            .join('')}
        </select>
      </div>

      <div class="field">
        <label class="label" for="receive-qty">Jumlah Masuk</label>
        <input class="input" type="number" id="receive-qty" min="0" step="0.001" value="1" />
      </div>

      <div class="field">
        <label class="label" for="receive-note">Keterangan</label>
        <input class="input" type="text" id="receive-note" maxlength="255"
               placeholder="Contoh: PO-2026-001 dari supplier" />
      </div>
    `,
    footer: `
      <button type="button" class="btn btn--ghost" data-close>Batal</button>
      <button type="button" class="btn btn--success" data-save>Catat Barang Masuk</button>
    `,
  });

  dialog.element.querySelector('[data-save]').addEventListener('click', async (event) => {
    const button = event.currentTarget;

    await withBusyButton(
      button,
      (async () => {
        try {
          const result = await api.post('/inventory/receive', {
            ingredient_id: Number($('#receive-ing').value),
            quantity: Number($('#receive-qty').value),
            note: $('#receive-note').value.trim(),
          });

          toast(
            `Barang masuk dicatat. Stok ${result.name} kini ${number(result.stockAfter, 3)} ${result.unit}.`,
            'success'
          );
          dialog.close();
          await Promise.all([loadIngredients(), loadSummary(), loadMovements()]);
        } catch (error) {
          toast(error.message, 'error', 5000);
        }
      })(),
      'Menyimpan...'
    );
  });
}

// ---------------------------------------------------------------------------
// Resep / BOM
// ---------------------------------------------------------------------------

async function loadProducts() {
  try {
    const result = await api.get('/products?limit=100');
    state.products = result.items || [];
  } catch (error) {
    console.error(error);
  }
}

async function loadRecipes() {
  try {
    state.recipes = await api.get('/inventory/recipes');
    renderRecipes();
  } catch (error) {
    console.error(error);
  }
}

function renderRecipes() {
  const grid = $('#recipe-grid');
  const withRecipe = new Map(state.recipes.map((recipe) => [recipe.productId, recipe]));

  if (state.products.length === 0) {
    showEmpty(grid, 'Belum ada produk.');
    return;
  }

  grid.innerHTML = state.products
    .map((product) => {
      const recipe = withRecipe.get(product.id);
      const ingredients = recipe ? recipe.items : [];

      const lines = ingredients.length
        ? ingredients
            .map(
              (item) => `
          <tr>
            <td>${escapeHtml(item.ingredient.name)}</td>
            <td class="num">${number(item.quantity, 3)} ${escapeHtml(item.unit)}</td>
            <td class="num muted">${number(item.wastePercent, 0)}%</td>
          </tr>`
            )
            .join('')
        : '<tr><td colspan="3" class="muted text-center">Belum ada komposisi</td></tr>';

      return `
        <div class="card">
          <div class="card__header">
            <div>
              <span class="card__title">${escapeHtml(product.name)}</span>
              <div class="tiny muted mono">${escapeHtml(product.code)}</div>
            </div>
            <div class="row">
              ${
                recipe
                  ? '<span class="badge badge--success">Punya resep</span>'
                  : '<span class="badge badge--warning">Tanpa resep</span>'
              }
              ${
                state.canManage
                  ? `<button type="button" class="btn btn--outline btn--small"
                       data-recipe="${product.id}">
                       ${recipe ? 'Ubah' : 'Buat'}
                     </button>`
                  : ''
              }
            </div>
          </div>
          <div class="card__body card__body--flush">
            ${
              recipe
                ? `<div class="table-wrapper">
                     <table class="table table--compact">
                       <thead>
                         <tr><th>Bahan</th><th class="num">Takaran/porsi</th><th class="num">Susuan</th></tr>
                       </thead>
                       <tbody>${lines}</tbody>
                     </table>
                   </div>`
                : `<div class="table-wrapper">
                     <table class="table table--compact">
                       <tbody>${lines}</tbody>
                     </table>
                   </div>`
            }
          </div>
        </div>
      `;
    })
    .join('');

  $$('[data-recipe]', grid).forEach((button) => {
    button.addEventListener('click', () => {
      const productId = Number(button.dataset.recipe);
      const product = state.products.find((p) => p.id === productId);
      const recipe = withRecipe.get(productId);
      openRecipeForm(product, recipe);
    });
  });
}

function openRecipeForm(product, existing) {
  let items = existing
    ? existing.items.map((item) => ({
        ingredientId: item.ingredientId,
        quantity: item.quantity,
        wastePercent: item.wastePercent,
      }))
    : [{ ingredientId: state.ingredients[0]?.id, quantity: 0, wastePercent: 0 }];

  const dialog = modal({
    title: `Resep: ${product.name}`,
    size: 'lg',
    content: `
      <div class="alert alert--warning" style="margin-bottom: 1rem;">
        Takaran memakai satuan bahan yang sama. Contoh: Beras bersatuan
        <strong>kg</strong>, jadi 0.150 berarti 150 gram per porsi.
      </div>

      <div class="field">
        <label class="label" for="recipe-yield">Jumlah Porsi per Batch</label>
        <input class="input" type="number" id="recipe-yield" min="0.001" step="1"
               value="${existing?.yieldQuantity ?? 1}" style="max-width: 160px;" />
      </div>

      <div class="divider"></div>

      <div class="section__header">
        <h3 style="margin: 0;">Komposisi</h3>
        <button type="button" class="btn btn--outline btn--small" id="add-line">+ Tambah Bahan</button>
      </div>

      <div class="table-wrapper">
        <table class="table table--compact">
          <thead>
            <tr>
              <th>Bahan</th>
              <th class="num">Takaran</th>
              <th class="num">Satuan</th>
              <th class="num">Susuan %</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="recipe-lines"></tbody>
        </table>
      </div>
    `,
    footer: `
      ${
        existing
          ? '<button type="button" class="btn btn--danger" data-remove>Nonaktifkan</button>'
          : ''
      }
      <button type="button" class="btn btn--ghost" data-close>Batal</button>
      <button type="button" class="btn btn--primary" data-save>Simpan Resep</button>
    `,
  });

  const root = dialog.element;
  const tbody = root.querySelector('#recipe-lines');

  function renderLines() {
    tbody.innerHTML = items
      .map(
        (item, index) => `
      <tr data-line="${index}">
        <td>
          <select class="select" data-line-ingredient="${index}">
            ${state.ingredients
              .filter((i) => i.isActive)
              .map(
                (i) =>
                  `<option value="${i.id}" ${i.id === item.ingredientId ? 'selected' : ''}>
                     ${escapeHtml(i.name)} (${escapeHtml(i.unit)})
                   </option>`
              )
              .join('')}
          </select>
        </td>
        <td class="num">
          <input class="input" type="number" min="0" step="0.001" style="max-width: 110px;"
                 data-line-quantity="${index}" value="${item.quantity}" />
        </td>
        <td class="num" data-line-unit="${index}"></td>
        <td class="num">
          <input class="input" type="number" min="0" max="100" step="1" style="max-width: 90px;"
                 data-line-waste="${index}" value="${item.wastePercent}" />
        </td>
        <td>
          <button type="button" class="btn btn--ghost btn--small" data-remove-line="${index}">×</button>
        </td>
      </tr>`
      )
      .join('');

    // Tampilkan satuan di kolom terpisah supaya pengguna melihat satuan takaran.
    items.forEach((item, index) => {
      const ingredient = state.ingredients.find((i) => i.id === item.ingredientId);
      const cell = tbody.querySelector(`[data-line-unit="${index}"]`);
      if (cell) cell.textContent = ingredient ? ingredient.unit : '-';
    });

    $$('[data-remove-line]', tbody).forEach((button) => {
      button.addEventListener('click', () => {
        items.splice(Number(button.dataset.removeLine), 1);
        if (items.length === 0) {
          items.push({ ingredientId: state.ingredients[0]?.id, quantity: 0, wastePercent: 0 });
        }
        renderLines();
      });
    });

    $$('[data-line-ingredient]', tbody).forEach((select) => {
      select.addEventListener('change', (event) => {
        const index = Number(event.target.dataset.lineIngredient);
        items[index].ingredientId = Number(event.target.value);
        renderLines();
      });
    });

    $$('[data-line-quantity]', tbody).forEach((input) => {
      input.addEventListener('change', (event) => {
        items[Number(event.target.dataset.lineQuantity)].quantity = Number(event.target.value);
      });
    });

    $$('[data-line-waste]', tbody).forEach((input) => {
      input.addEventListener('change', (event) => {
        items[Number(event.target.dataset.lineWaste)].wastePercent = Number(event.target.value);
      });
    });
  }

  renderLines();

  root.querySelector('#add-line').addEventListener('click', () => {
    items.push({ ingredientId: state.ingredients[0]?.id, quantity: 0, wastePercent: 0 });
    renderLines();
  });

  root.querySelector('[data-save]').addEventListener('click', async (event) => {
    const button = event.currentTarget;

    await withBusyButton(
      button,
      (async () => {
        try {
          await api.put(`/inventory/recipes/products/${product.id}`, {
            yield_quantity: Number($('#recipe-yield').value) || 1,
            items: items
              .filter((item) => Number(item.quantity) > 0)
              .map((item) => ({
                ingredient_id: item.ingredientId,
                quantity: Number(item.quantity),
                waste_percent: Number(item.wastePercent) || 0,
              })),
          });

          toast(`Resep ${product.name} tersimpan.`, 'success');
          dialog.close();
          await loadRecipes();
        } catch (error) {
          toast(error.message, 'error', 5000);
        }
      })(),
      'Menyimpan...'
    );
  });

  const removeButton = root.querySelector('[data-remove]');
  if (removeButton) {
    removeButton.addEventListener('click', async () => {
      const confirmed = await confirmDialog(
        'Nonaktifkan resep?',
        `Produk "${product.name}" tidak lagi akan mengurangi stok bahan baku saat terjual.`,
        { confirmLabel: 'Nonaktifkan', danger: true }
      );
      if (!confirmed) return;

      try {
        await api.delete(`/inventory/recipes/products/${product.id}`);
        toast('Resep dinonaktifkan.', 'success');
        dialog.close();
        await loadRecipes();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Jurnal mutasi
// ---------------------------------------------------------------------------

async function loadMovements() {
  const tbody = $('#movement-tbody');
  showLoading(tbody, 'Memuat jurnal...');

  try {
    const result = await api.get(
      withQuery('/inventory/movements', {
        type: state.movementType || undefined,
        from: state.movementFrom || undefined,
        to: state.movementTo || undefined,
        page: state.movementPage,
        limit: 50,
      })
    );

    state.movements = result.items || [];
    renderMovements(result.meta || {});
  } catch (error) {
    showError(tbody, error.message, loadMovements);
  }
}

function renderMovements(meta) {
  const tbody = $('#movement-tbody');

  if (state.movements.length === 0) {
    showEmpty(tbody, 'Belum ada mutasi stok pada filter ini.');
    $('#movement-pagination').innerHTML = '';
    return;
  }

  tbody.innerHTML = state.movements
    .map(
      (row) => `
      <tr>
        <td data-label="Waktu" class="small muted">${dateTime(row.createdAt)}</td>
        <td data-label="Jenis">
          <span class="badge badge--${TYPE_BADGE[row.type] || 'neutral'}">
            ${escapeHtml(typeLabel(row.type))}
          </span>
        </td>
        <td data-label="Bahan"><strong>${escapeHtml(row.ingredientName)}</strong></td>
        <td data-label="Masuk" class="num text-success">
          ${row.quantityIn > 0 ? `+${number(row.quantityIn, 3)}` : '-'}
        </td>
        <td data-label="Keluar" class="num text-danger">
          ${row.quantityOut > 0 ? `-${number(row.quantityOut, 3)}` : '-'}
        </td>
        <td data-label="Stok akhir" class="num">
          ${number(row.stockAfter, 3)} ${escapeHtml(row.unit)}
        </td>
        <td data-label="Referensi" class="small muted">
          ${
            row.orderNumber
              ? `Order ${escapeHtml(row.orderNumber)}`
              : row.referenceType
              ? escapeHtml(row.referenceType)
              : '-'
          }
        </td>
      </tr>`
    )
    .join('');

  renderMovementPagination(meta);
}

function renderMovementPagination(meta) {
  const container = $('#movement-pagination');
  if (!meta.total) {
    container.innerHTML = '';
    return;
  }

  const { page, totalPages, total } = meta;

  container.innerHTML = `
    <span>Halaman ${page} dari ${totalPages} (total ${total} mutasi)</span>
    <div class="row">
      <button type="button" class="btn btn--outline btn--small" id="m-prev"
              ${page <= 1 ? 'disabled' : ''}>Sebelumnya</button>
      <button type="button" class="btn btn--outline btn--small" id="m-next"
              ${page >= totalPages ? 'disabled' : ''}>Berikutnya</button>
    </div>
  `;

  const prev = $('#m-prev');
  const next = $('#m-next');

  if (prev && !prev.disabled) {
    prev.addEventListener('click', () => {
      state.movementPage -= 1;
      loadMovements();
    });
  }
  if (next && !next.disabled) {
    next.addEventListener('click', () => {
      state.movementPage += 1;
      loadMovements();
    });
  }
}

// ---------------------------------------------------------------------------
// Stock opname
// ---------------------------------------------------------------------------

async function loadOpnames() {
  const tbody = $('#opname-tbody');
  showLoading(tbody, 'Memuat opname...');

  try {
    const result = await api.get('/inventory/opnames?limit=20');
    state.opnames = result.items || [];
    renderOpnames();
  } catch (error) {
    showError(tbody, error.message, loadOpnames);
  }
}

function renderOpnames() {
  const tbody = $('#opname-tbody');

  if (state.opnames.length === 0) {
    showEmpty(tbody, 'Belum ada stock opname.');
    return;
  }

  const statusBadge = { DRAFT: 'warning', APPROVED: 'success', CANCELLED: 'neutral' };

  tbody.innerHTML = state.opnames
    .map(
      (opname) => `
      <tr>
        <td data-label="Nomor"><strong>${escapeHtml(opname.opnameNumber)}</strong></td>
        <td data-label="Status">
          <span class="badge badge--${statusBadge[opname.status] || 'neutral'}">
            ${escapeHtml(opname.status)}
          </span>
        </td>
        <td data-label="Bahan" class="num">${number(opname.itemCount)}</td>
        <td data-label="Terisi" class="num">${number(opname.filledItems)} / ${number(opname.itemCount)}</td>
        <td data-label="Dibuat" class="small muted">${dateTime(opname.createdAt)}</td>
        <td data-label="Aksi" class="table__actions-cell">
          <div class="table__actions">
            <button type="button" class="btn btn--outline btn--small"
                    data-opname="${opname.id}">
              ${opname.status === 'DRAFT' ? 'Isi Hasil Hitung' : 'Lihat'}
            </button>
          </div>
        </td>
      </tr>`
    )
    .join('');

  $$('[data-opname]', tbody).forEach((button) => {
    button.addEventListener('click', () => openOpname(Number(button.dataset.opname)));
  });
}

async function openOpname(opnameId) {
  const container = $('#opname-detail');
  showLoading(container, 'Memuat detail opname...');
  state.openOpnameId = opnameId;

  let opname;
  try {
    opname = await api.get(`/inventory/opnames/${opnameId}`);
  } catch (error) {
    showError(container, error.message, () => openOpname(opnameId));
    return;
  }

  const editable = opname.status === 'DRAFT';

  container.innerHTML = `
    <div class="card" style="margin-bottom: 1rem;">
      <div class="card__header">
        <div>
          <span class="card__title">${escapeHtml(opname.opnameNumber)}</span>
          <p class="small muted mb-0">
            ${opname.totalItems} bahan, ${opname.filledItems} sudah diisi
            ${opname.status === 'APPROVED' ? `· disetujui ${dateTime(opname.approvedAt)}` : ''}
          </p>
        </div>
        <div class="row">
          ${
            editable && state.canManage
              ? `<button type="button" class="btn btn--success btn--small" id="approve-opname">
                   Setujui &amp; Sesuaikan Stok
                 </button>
                 <button type="button" class="btn btn--ghost btn--small" id="cancel-opname">
                   Batalkan
                 </button>`
              : `<button type="button" class="btn btn--ghost btn--small" id="close-opname">Tutup</button>`
          }
        </div>
      </div>

      <div class="card__body card__body--flush">
        <div class="table-wrapper">
          <table class="table table--compact">
            <thead>
              <tr>
                <th>Bahan</th>
                <th class="num">Stok Sistem</th>
                <th class="num">Hasil Hitung</th>
                <th class="num">Selisih</th>
              </tr>
            </thead>
            <tbody id="opname-items"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const tbody = container.querySelector('#opname-items');

  tbody.innerHTML = opname.items
    .map(
      (item) => `
      <tr>
        <td><strong>${escapeHtml(item.ingredientName)}</strong>
          <span class="muted tiny">${escapeHtml(item.unit)}</span></td>
        <td class="num">${number(item.systemStock, 3)}</td>
        <td class="num">
          ${
            editable
              ? `<input class="input" type="number" min="0" step="0.001"
                       style="max-width: 130px;" data-physical="${item.ingredientId}"
                       value="${item.physicalStock ?? ''}" placeholder="?" />`
              : `<strong>${item.physicalStock === null ? '-' : number(item.physicalStock, 3)}</strong>`
          }
        </td>
        <td class="num ${item.difference !== 0 ? (item.difference > 0 ? 'text-success' : 'text-danger') : 'muted'}">
          ${item.difference === 0 ? '-' : (item.difference > 0 ? '+' : '') + number(item.difference, 3)}
        </td>
      </tr>`
    )
    .join('');

  // Simpan otomatis saat kolom hasil hitung dikosongkan.
  if (editable) {
    $$('[data-physical]', tbody).forEach((input) => {
      input.addEventListener(
        'change',
        debounce(async (event) => {
          const ingredientId = Number(event.target.dataset.physical);
          const raw = event.target.value.trim();
          const physicalStock = raw === '' ? null : Number(raw);

          try {
            await api.put(
              `/inventory/opnames/${opnameId}/items/${ingredientId}`,
              { physical_stock: physicalStock }
            );
            const updated = await api.get(`/inventory/opnames/${opnameId}`);
            openOpname(opnameId);
            loadOpnames();
          } catch (error) {
            toast(error.message, 'error');
          }
        }, 400)
      );
    });
  }

  const approveButton = $('#approve-opname');
  if (approveButton) {
    approveButton.addEventListener('click', async (event) => {
      const confirmed = await confirmDialog(
        'Setujui opname ini?',
        'Stok sistem akan disesuaikan dengan hasil hitung fisik, dan selisihnya dicatat di jurnal mutasi.',
        { confirmLabel: 'Setujui' }
      );
      if (!confirmed) return;

      await withBusyButton(
        event.currentTarget,
        (async () => {
          try {
            const result = await api.post(`/inventory/opnames/${opnameId}/approve`, {});
            toast(
              `Opname disetujui, ${result.data.adjusted.length} bahan disesuaikan.`,
              'success',
              5000
            );
            await Promise.all([
              openOpname(opnameId),
              loadOpnames(),
              loadIngredients(),
              loadSummary(),
              loadMovements(),
            ]);
          } catch (error) {
            toast(error.message, 'error', 6000);
          }
        })(),
        'Memproses...'
      );
    });
  }

  const cancelButton = $('#cancel-opname');
  if (cancelButton) {
    cancelButton.addEventListener('click', async () => {
      const confirmed = await confirmDialog(
        'Batalkan opname?',
        'Stok tidak akan berubah dan hasil hitung yang sudah diisi diabaikan.',
        { confirmLabel: 'Batalkan', danger: true }
      );
      if (!confirmed) return;

      try {
        await api.post(`/inventory/opnames/${opnameId}/cancel`, {});
        toast('Opname dibatalkan.', 'info');
        container.innerHTML = '';
        state.openOpnameId = null;
        loadOpnames();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  const closeButton = $('#close-opname');
  if (closeButton) {
    closeButton.addEventListener('click', () => {
      container.innerHTML = '';
      state.openOpnameId = null;
    });
  }
}

async function createOpname() {
  const confirmed = await confirmDialog(
    'Buat stock opname?',
    'Semua bahan baku aktif akan dimuat ke daftar hitung dengan stok sistem saat ini.',
    { confirmLabel: 'Buat' }
  );
  if (!confirmed) return;

  try {
    const result = await api.post('/inventory/opnames', { include_all: true });
    toast(`Stock opname ${result.data.opnameNumber} dibuat.`, 'success');
    await loadOpnames();
    await openOpname(result.data.id);
  } catch (error) {
    toast(error.message, 'error');
  }
}

// ---------------------------------------------------------------------------
// Utilitas
// ---------------------------------------------------------------------------

/**
 * Tunda pemanggilan agar tidak terjadi request pada setiap ketikan.
 * @param {Function} callback
 * @param {number} delay
 */
function debounce(callback, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}

// ---------------------------------------------------------------------------
// Event
// ---------------------------------------------------------------------------

function wireTabs() {
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach((t) => t.classList.remove('tab--active'));
      $$('.tab-panel').forEach((p) => p.classList.remove('tab-panel--active'));
      tab.classList.add('tab--active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('tab-panel--active');
    });
  });
}

function wireEvents() {
  $('#refresh-button').addEventListener('click', () => {
    loadSummary();
    loadIngredients();
    loadRecipes();
    loadMovements();
    loadOpnames();
  });

  $('#new-ingredient-button').addEventListener('click', () => openIngredientForm());
  $('#receive-button').addEventListener('click', openReceiveDialog);
  $('#new-opname-button').addEventListener('click', createOpname);

  $('#new-recipe-button').addEventListener('click', () => {
    const withoutRecipe = state.products.find(
      (product) => !state.recipes.some((recipe) => recipe.productId === product.id)
    );
    if (withoutRecipe) {
      openRecipeForm(withoutRecipe, null);
    } else {
      toast('Semua produk sudah punya resep.', 'info');
    }
  });

  $('#ingredient-search').addEventListener(
    'input',
    debounce((event) => {
      state.search = event.target.value.trim();
      loadIngredients();
    }, 300)
  );

  $('#low-stock-only').addEventListener('change', (event) => {
    state.lowStockOnly = event.target.checked;
    loadIngredients();
  });

  $('#movement-filter').addEventListener('click', () => {
    state.movementType = $('#movement-type').value;
    state.movementFrom = $('#movement-from').value;
    state.movementTo = $('#movement-to').value;
    state.movementPage = 1;
    loadMovements();
  });

  $('#logout-button').addEventListener('click', async () => {
    try {
      await api.post('/auth/logout', { refreshToken: tokenStore.refreshToken });
    } catch {
      // Tetap logout lokal walau server tidak terjangkau.
    }
    tokenStore.clear();
    window.location.replace('/index.html');
  });
}