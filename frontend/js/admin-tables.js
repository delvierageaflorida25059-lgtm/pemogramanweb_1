/**
 * Halaman pengelolaan meja dan QR code.
 *
 * Catatan desain: QR yang dicetak hanya berisi URL ber-token. Token-nya
 * dicocokkan ke tabel table_qr_codes di server. Meu lama yang sudah dicetak
 * tetap berlaku selama token-nya belum dicabut.
 */

import { api, tokenStore } from './api.js';
import { createQrCard } from './qr.js';
import {
  $,
  $$,
  escapeHtml,
  toast,
  modal,
  confirmDialog,
  showError,
  showEmpty,
  requireLogin,
  withBusyButton,
} from './ui.js';

if (!requireLogin({ requiredPermissions: ['table.view'] })) {
  throw new Error('Akses ditolak');
}

const state = {
  tables: [],
  canManage: false,
  canManageQr: false,
};

const STATUS_LABELS = {
  AVAILABLE: 'Tersedia',
  OCCUPIED: 'Terisi',
  RESERVED: 'Dipesan',
  DISABLED: 'Nonaktif',
};

const STATUS_BADGES = {
  AVAILABLE: 'success',
  OCCUPIED: 'warning',
  RESERVED: 'info',
  DISABLED: 'neutral',
};

document.addEventListener('DOMContentLoaded', async () => {
  $('#user-label').textContent = tokenStore.user?.name || '';

  const permissions = tokenStore.user?.permissions || [];
  const isAdmin = (tokenStore.user?.roles || []).includes('ADMIN');
  state.canManage = isAdmin || permissions.includes('table.manage');
  state.canManageQr = isAdmin || permissions.includes('table.qr');

  if (!state.canManage) $('#new-table-button').hidden = true;

  $('#logout-button').addEventListener('click', logout);
  $('#new-table-button').addEventListener('click', () => openTableForm());
  $('#print-qr-button').addEventListener('click', () => window.print());

  // Tab switching
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach((t) => t.classList.remove('tab--active'));
      $$('.tab-panel').forEach((p) => p.classList.remove('tab-panel--active'));
      tab.classList.add('tab--active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('tab-panel--active');
    });
  });

  await loadTables();
});

// ---------------------------------------------------------------------------

async function loadTables() {
  const grid = $('#table-grid');

  try {
    state.tables = await api.get('/tables');
    renderTables();
    renderQr();
  } catch (error) {
    showError(grid, error.message, loadTables);
  }
}

function renderTables() {
  const grid = $('#table-grid');

  if (state.tables.length === 0) {
    showEmpty(grid, 'Belum ada meja. Buat meja pertama.');
    return;
  }

  grid.innerHTML = state.tables
    .map(
      (table) => `
      <div class="card">
        <div class="card__body">
          <div class="row row--between" style="margin-bottom: 0.5rem;">
            <div>
              <h3 style="margin: 0;">Meja ${escapeHtml(table.code)}</h3>
              <p class="small muted mb-0">${escapeHtml(table.name)}</p>
            </div>
            <span class="badge badge--${STATUS_BADGES[table.status]}">
              ${escapeHtml(STATUS_LABELS[table.status])}
            </span>
          </div>

          <p class="small muted">
            Area ${escapeHtml(table.zone || '-')} ·
            Kapasitas ${table.capacity} orang
            ${table.activeOrderCount > 0
              ? `<br /><span class="text-warning">${table.activeOrderCount} pesanan aktif</span>`
              : ''}
          </p>

          ${
            state.canManage
              ? `
            <div class="row" style="margin-top: 0.75rem;">
              <button type="button" class="btn btn--outline btn--small"
                      data-edit="${table.id}">Ubah</button>
              <button type="button" class="btn btn--danger btn--small"
                      data-delete="${table.id}">Hapus</button>
            </div>`
              : ''
          }
        </div>
      </div>`
    )
    .join('');

  $$('[data-edit]', grid).forEach((button) => {
    button.addEventListener('click', () => {
      const table = state.tables.find((t) => t.id === Number(button.dataset.edit));
      openTableForm(table);
    });
  });

  $$('[data-delete]', grid).forEach((button) => {
    button.addEventListener('click', () => deleteTable(Number(button.dataset.delete)));
  });
}

function renderQr() {
  const grid = $('#qr-grid');

  if (!state.canManageQr) {
    grid.innerHTML =
      '<div class="alert alert--warning">Anda tidak memiliki izin untuk melihat QR code.</div>';
    return;
  }

  const withQr = state.tables.filter((table) => table.qr);

  if (withQr.length === 0) {
    showEmpty(grid, 'Belum ada QR code aktif.');
    return;
  }

  grid.innerHTML = '';
  for (const table of withQr) {
    const card = createQrCard(table, 200);

    // Tombol terbitkan ulang QR.
    const regenerate = document.createElement('button');
    regenerate.type = 'button';
    regenerate.className = 'btn btn--outline btn--small';
    regenerate.textContent = 'Terbitkan Ulang';
    regenerate.addEventListener('click', () => regenerateQr(table));

    card.appendChild(regenerate);
    grid.appendChild(card);
  }
}

function openTableForm(table = null) {
  const isEdit = Boolean(table);

  const dialog = modal({
    title: isEdit ? `Ubah Meja ${table.code}` : 'Tambah Meja Baru',
    size: 'sm',
    content: `
      <div class="form-row">
        <div class="field">
          <label class="label" for="table-code">Kode Meja <span class="required">*</span></label>
          <input class="input" type="text" id="table-code" maxlength="20"
                 placeholder="Contoh: A01" value="${escapeHtml(table?.code || '')}" />
          <p class="field__hint">Kode ini yang dicetak pada QR.</p>
        </div>
        <div class="field">
          <label class="label" for="table-zone">Area</label>
          <input class="input" type="text" id="table-zone" maxlength="50"
                 placeholder="Indoor / Outdoor / VIP"
                 value="${escapeHtml(table?.zone || '')}" />
        </div>
      </div>

      <div class="field">
        <label class="label" for="table-name">Nama Meja</label>
        <input class="input" type="text" id="table-name" maxlength="100"
               value="${escapeHtml(table?.name || '')}" />
      </div>

      <div class="form-row">
        <div class="field">
          <label class="label" for="table-capacity">Kapasitas</label>
          <input class="input" type="number" id="table-capacity" min="1" max="100"
                 value="${table?.capacity ?? 4}" />
        </div>
        <div class="field">
          <label class="label" for="table-status">Status</label>
          <select class="select" id="table-status">
            ${Object.entries(STATUS_LABELS)
              .map(
                ([value, label]) =>
                  `<option value="${value}" ${table?.status === value ? 'selected' : ''}>
                     ${escapeHtml(label)}
                   </option>`
              )
              .join('')}
          </select>
        </div>
      </div>
    `,
    footer: `
      <button type="button" class="btn btn--ghost" data-close>Batal</button>
      <button type="button" class="btn btn--primary" data-save>Simpan</button>
    `,
  });

  dialog.element.querySelector('[data-save]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const payload = {
      code: $('#table-code').value.trim(),
      zone: $('#table-zone').value.trim(),
      name: $('#table-name').value.trim(),
      capacity: Number($('#table-capacity').value) || 4,
      status: $('#table-status').value,
    };

    await withBusyButton(
      button,
      (async () => {
        try {
          if (isEdit) {
            await api.put(`/tables/${table.id}`, payload);
            toast('Meja diperbarui.', 'success');
          } else {
            await api.post('/tables', payload);
            toast('Meja dibuat beserta QR code.', 'success');
          }
          dialog.close();
          loadTables();
        } catch (error) {
          toast(error.message, 'error');
        }
      })(),
      'Menyimpan...'
    );
  });
}

async function deleteTable(tableId) {
  const table = state.tables.find((t) => t.id === tableId);

  const confirmed = await confirmDialog(
    'Hapus meja?',
    `Meja "${table.code}" akan dihapus beserta QR-nya. Meja yang pernah dipakai transaksi hanya bisa dinonaktifkan.`,
    { confirmLabel: 'Hapus', danger: true }
  );
  if (!confirmed) return;

  try {
    await api.delete(`/tables/${tableId}`);
    toast('Meja dihapus.', 'success');
    loadTables();
  } catch (error) {
    toast(error.message, 'error', 5000);
  }
}

async function regenerateQr(table) {
  const confirmed = await confirmDialog(
    'Terbitkan ulang QR?',
    `QR lama untuk meja ${table.code} akan dicabut. QR yang sudah dicetak dan tidak lagi berlaku akan gagal dipindai.`,
    { confirmLabel: 'Terbitkan Ulang', danger: true }
  );
  if (!confirmed) return;

  try {
    await api.post(`/tables/${table.id}/qr`, { label: `QR ${table.code}` });
    toast('QR baru berhasil diterbitkan.', 'success');
    loadTables();
  } catch (error) {
    toast(error.message, 'error');
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