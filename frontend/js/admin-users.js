/**
 * Halaman manajemen user & role.
 *
 * Hanya bisa diakses pengguna dengan permission user.view. Perubahan data
 * user butuh user.manage, sedangkan perubahan permission role butuh
 * role.manage. Tombol otomatis disembunyikan bila permission tidak dimiliki.
 */

import { api, tokenStore, withQuery } from './api.js';
import {
  $,
  $$,
  escapeHtml,
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

if (!requireLogin({ requiredPermissions: ['user.view'] })) {
  throw new Error('Akses ditolak');
}

const state = {
  page: 1,
  limit: 15,
  search: '',
  users: [],
  roles: [],
  permissionsByModule: [],
  canManageUsers: false,
  canManageRoles: false,
};

document.addEventListener('DOMContentLoaded', async () => {
  $('#user-label').textContent = tokenStore.user?.name || '';

  const permissions = tokenStore.user?.permissions || [];
  const isAdmin = (tokenStore.user?.roles || []).includes('ADMIN');
  state.canManageUsers = isAdmin || permissions.includes('user.manage');
  state.canManageRoles = isAdmin || permissions.includes('role.manage');

  if (!state.canManageUsers) $('#new-user-button').hidden = true;

  $('#logout-button').addEventListener('click', logout);
  $('#refresh-button').addEventListener('click', () => {
    loadUsers();
    loadRoles();
  });
  $('#new-user-button').addEventListener('click', openUserForm);

  $('#search-input').addEventListener('input', debounce((event) => {
    state.search = event.target.value.trim();
    state.page = 1;
    loadUsers();
  }, 300));

  await Promise.all([loadUsers(), loadRoles()]);
});

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

async function loadUsers() {
  const tbody = $('#user-tbody');
  showLoading(tbody, 'Memuat pengguna...');

  try {
    const result = await api.get(
      withQuery('/users', {
        page: state.page,
        limit: state.limit,
        search: state.search || undefined,
      })
    );

    state.users = result.items || result.data || [];
    renderUsers(result);
  } catch (error) {
    showError(tbody, error.message, loadUsers);
  }
}

function renderUsers(result) {
  const tbody = $('#user-tbody');
  const meta = result.meta || {};

  if (state.users.length === 0) {
    showEmpty(tbody, 'Tidak ada pengguna yang cocok.');
    renderPagination(meta);
    return;
  }

  tbody.innerHTML = state.users
    .map(
      (user) => `
      <tr>
        <td data-label="Nama"><strong>${escapeHtml(user.name)}</strong></td>
        <td data-label="Email" class="mono small">${escapeHtml(user.email)}</td>
        <td data-label="Role">
          ${(user.roles || [])
            .map((role) => `<span class="badge badge--info">${escapeHtml(role)}</span>`)
            .join(' ')}
        </td>
        <td data-label="Status">
          <span class="badge badge--${user.status === 'ACTIVE' ? 'success' : 'danger'}">
            ${escapeHtml(user.status)}
          </span>
        </td>
        <td data-label="Login Terakhir" class="small muted">
          ${user.last_login_at ? dateTime(user.last_login_at) : 'Belum pernah'}
        </td>
        <td data-label="Aksi" class="table__actions-cell">
          <div class="table__actions">
            ${
              state.canManageUsers
                ? `<button type="button" class="btn btn--outline btn--small" data-edit="${user.id}">Ubah</button>
                   ${
                     user.status === 'ACTIVE'
                       ? `<button type="button" class="btn btn--danger btn--small" data-deactivate="${user.id}">Nonaktifkan</button>`
                       : `<button type="button" class="btn btn--success btn--small" data-activate="${user.id}">Aktifkan</button>`
                   }`
                : ''
            }
          </div>
        </td>
      </tr>`
    )
    .join('');

  $$('[data-edit]', tbody).forEach((button) => {
    button.addEventListener('click', () => {
      const user = state.users.find((u) => u.id === Number(button.dataset.edit));
      openUserForm(user);
    });
  });

  $$('[data-deactivate]', tbody).forEach((button) => {
    button.addEventListener('click', () => changeStatus(button.dataset.deactivate, 'INACTIVE'));
  });

  $$('[data-activate]', tbody).forEach((button) => {
    button.addEventListener('click', () => changeStatus(button.dataset.activate, 'ACTIVE'));
  });

  renderPagination(meta);
}

async function changeStatus(userId, status) {
  const user = state.users.find((u) => u.id === Number(userId));
  const isDeactivate = status === 'INACTIVE';

  const confirmed = await confirmDialog(
    isDeactivate ? 'Nonaktifkan user?' : 'Aktifkan user?',
    isDeactivate
      ? `${user.name} tidak akan bisa masuk lagi. Riwayat aktivitas tetap tersimpan.`
      : `${user.name} akan bisa masuk kembali ke sistem.`,
    { confirmLabel: isDeactivate ? 'Nonaktifkan' : 'Aktifkan', danger: isDeactivate }
  );
  if (!confirmed) return;

  try {
    await api.put(`/users/${userId}`, { status });
    toast('Status user diperbarui.', 'success');
    loadUsers();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function renderPagination(meta = {}) {
  const container = $('#pagination');

  if (!meta.total) {
    container.innerHTML = '';
    return;
  }

  const { page, totalPages, total } = meta;

  container.innerHTML = `
    <span>Menampilkan halaman ${page} dari ${totalPages} (total ${total} user)</span>
    <div class="row">
      <button type="button" class="btn btn--outline btn--small" id="prev-page"
              ${page <= 1 ? 'disabled' : ''}>Sebelumnya</button>
      <button type="button" class="btn btn--outline btn--small" id="next-page"
              ${page >= totalPages ? 'disabled' : ''}>Berikutnya</button>
    </div>
  `;

  const prev = $('#prev-page');
  const next = $('#next-page');

  if (prev && !prev.disabled) {
    prev.addEventListener('click', () => {
      state.page -= 1;
      loadUsers();
    });
  }
  if (next && !next.disabled) {
    next.addEventListener('click', () => {
      state.page += 1;
      loadUsers();
    });
  }
}

/** Dialog tambah / ubah user. */
function openUserForm(user = null) {
  const isEdit = Boolean(user);

  const roleOptions = state.roles
    .map(
      (role) => `
      <label class="checkbox">
        <input type="checkbox" name="roles" value="${escapeHtml(role.name)}"
               ${user?.roles?.includes(role.name) ? 'checked' : ''} />
        <span>${escapeHtml(role.name)}</span>
      </label>`
    )
    .join('');

  const dialog = modal({
    title: isEdit ? `Ubah User: ${user.name}` : 'Tambah User Baru',
    content: `
      <div class="field">
        <label class="label" for="user-name">Nama Lengkap <span class="required">*</span></label>
        <input class="input" type="text" id="user-name" maxlength="100"
               value="${escapeHtml(user?.name || '')}" />
        <p class="field__error" id="error-name" hidden></p>
      </div>

      <div class="field">
        <label class="label" for="user-email">Email <span class="required">*</span></label>
        <input class="input" type="email" id="user-email" maxlength="150"
               value="${escapeHtml(user?.email || '')}" />
        <p class="field__error" id="error-email" hidden></p>
      </div>

      <div class="field">
        <label class="label" for="user-phone">Nomor HP</label>
        <input class="input" type="tel" id="user-phone" maxlength="30"
               value="${escapeHtml(user?.phone || '')}" />
      </div>

      ${
        !isEdit
          ? `
        <div class="field">
          <label class="label" for="user-password">Password <span class="required">*</span></label>
          <input class="input" type="password" id="user-password" minlength="8" />
          <p class="field__hint">Minimal 8 karakter.</p>
          <p class="field__error" id="error-password" hidden></p>
        </div>`
          : ''
      }

      <div class="field">
        <span class="label">Role <span class="required">*</span></span>
        <div class="stack stack--sm">${roleOptions}</div>
        <p class="field__error" id="error-roles" hidden></p>
      </div>
    `,
    footer: `
      <button type="button" class="btn btn--ghost" data-close>Batal</button>
      <button type="button" class="btn btn--primary" data-save>
        ${isEdit ? 'Simpan Perubahan' : 'Buat User'}
      </button>
    `,
  });

  dialog.element.querySelector('[data-save]').addEventListener('click', async (event) => {
    const button = event.currentTarget;

    const payload = {
      name: $('#user-name').value.trim(),
      email: $('#user-email').value.trim(),
      phone: $('#user-phone').value.trim(),
      roles: $$('input[name="roles"]:checked').map((input) => input.value),
    };

    if (!isEdit) payload.password = $('#user-password').value;

    // Bersihkan pesan error sebelumnya.
    $$('.field__error').forEach((element) => (element.hidden = true));

    await withBusyButton(
      button,
      (async () => {
        try {
          if (isEdit) {
            await api.put(`/users/${user.id}`, payload);
            toast('User berhasil diperbarui.', 'success');
          } else {
            await api.post('/users', payload);
            toast('User berhasil dibuat.', 'success');
          }
          dialog.close();
          loadUsers();
        } catch (error) {
          showFormErrors(error);
          toast(error.message, 'error');
        }
      })(),
      'Menyimpan...'
    );
  });
}

/** Tampilkan error per-field dari respons server. */
function showFormErrors(error) {
  const errors = error?.errors;
  if (!errors || typeof errors !== 'object') return;

  for (const [field, message] of Object.entries(errors)) {
    const element = document.getElementById(`error-${field}`);
    if (element) {
      element.textContent = message;
      element.hidden = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Role & permission
// ---------------------------------------------------------------------------

async function loadRoles() {
  const tbody = $('#role-tbody');
  showLoading(tbody, 'Memuat role...');

  try {
    state.roles = await api.get('/users/roles/list');
    renderRoles();

    if (state.canManageRoles) {
      state.permissionsByModule = await api.get('/users/roles/permissions');
    }
  } catch (error) {
    showError(tbody, error.message, loadRoles);
  }
}

function renderRoles() {
  const tbody = $('#role-tbody');

  if (state.roles.length === 0) {
    showEmpty(tbody, 'Belum ada role.');
    return;
  }

  tbody.innerHTML = state.roles
    .map(
      (role) => `
      <tr>
        <td data-label="Role">
          <strong>${escapeHtml(role.name)}</strong>
          ${role.is_system ? '<span class="badge badge--neutral">Sistem</span>' : ''}
        </td>
        <td data-label="Deskripsi" class="muted small">${escapeHtml(role.description || '-')}</td>
        <td data-label="Permission" class="num">${role.permission_count}</td>
        <td data-label="User" class="num">${role.user_count}</td>
        <td data-label="Aksi" class="table__actions-cell">
          <div class="table__actions">
            ${
              state.canManageRoles && !role.is_system
                ? `<button type="button" class="btn btn--outline btn--small"
                     data-role="${role.id}">Manage Permission</button>`
                : ''
            }
          </div>
        </td>
      </tr>`
    )
    .join('');

  $$('[data-role]', tbody).forEach((button) => {
    button.addEventListener('click', () => openRolePermissions(Number(button.dataset.role)));
  });
}

/** Dialog untuk memilih permission sebuah role. */
async function openRolePermissions(roleId) {
  const role = state.roles.find((r) => r.id === roleId);
  const dialog = modal({
    title: `Permission untuk Role: ${role.name}`,
    size: 'lg',
    content: '<div id="role-perm-body"><p class="muted">Memuat...</p></div>',
    footer: `
      <button type="button" class="btn btn--ghost" data-close>Batal</button>
      <button type="button" class="btn btn--primary" data-save>Simpan Permission</button>
    `,
  });

  const body = dialog.element.querySelector('#role-perm-body');

  try {
    const detail = await api.get(`/users/roles/${roleId}`);
    const current = new Set(detail.permissions || []);

    body.innerHTML = `
      <p class="muted small">Centang permission yang boleh dilakukan pengguna dengan role ini.</p>
      ${state.permissionsByModule
        .map(
          (group) => `
        <div class="card" style="margin-bottom: 1rem;">
          <div class="card__header">
            <span class="card__title">${escapeHtml(group.module)}</span>
            <label class="checkbox">
              <input type="checkbox" data-module-all="${escapeHtml(group.module)}" />
              <span class="tiny">Pilih semua</span>
            </label>
          </div>
          <div class="card__body">
            <div class="stack stack--sm">
              ${group.permissions
                .map(
                  (code) => `
                <label class="checkbox">
                  <input type="checkbox" name="perm" value="${escapeHtml(code)}"
                         ${current.has(code) ? 'checked' : ''} />
                  <span>
                    <code>${escapeHtml(code)}</code>
                    <span class="muted tiny"> - ${escapeHtml(group.descriptions[code] || '')}</span>
                  </span>
                </label>`
                )
                .join('')}
            </div>
          </div>
        </div>`
        )
        .join('')}
    `;

    // Centang semua permission dalam satu modul.
    $$('[data-module-all]', body).forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const module = checkbox.dataset.moduleAll;
        const group = state.permissionsByModule.find((g) => g.module === module);
        group.permissions.forEach((code) => {
          const input = body.querySelector(`input[name="perm"][value="${CSS.escape(code)}"]`);
          if (input) input.checked = checkbox.checked;
        });
      });
    });

    dialog.element.querySelector('[data-save]').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const permissions = $$('input[name="perm"]:checked', body).map((input) => input.value);

      await withBusyButton(
        button,
        (async () => {
          try {
            await api.put(`/users/roles/${roleId}/permissions`, { permissions });
            toast(`Permission role ${role.name} diperbarui.`, 'success');
            dialog.close();
            loadRoles();
          } catch (error) {
            toast(error.message, 'error');
          }
        })(),
        'Menyimpan...'
      );
    });
  } catch (error) {
    body.innerHTML = `<div class="alert alert--danger">${escapeHtml(error.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------

/** Tunda pemanggilan agar tidak terjadi request pada setiap ketikan. */
function debounce(callback, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
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