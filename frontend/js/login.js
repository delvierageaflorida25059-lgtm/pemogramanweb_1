/**
 * Halaman login.
 *
 * Setelah berhasil, pengguna diarahkan ke halaman yang cocok dengan role-nya.
 * Parameter ?next= dipakai untuk kembali ke halaman tujuan semula.
 */

import { api, tokenStore, fieldErrors } from './api.js';
import { $, defaultPageForRoles, toast, withBusyButton } from './ui.js';

const form = $('#login-form');
const button = $('#login-button');
const errorBox = $('#form-error');

// Isi form dari parameter ?next= agar tahu halaman tujuan setelah login.
const params = new URLSearchParams(window.location.search);
const nextUrl = params.get('next');

// Kalau sudah login, langsung ke halaman tujuan.
if (tokenStore.accessToken && tokenStore.user) {
  window.location.replace(nextUrl || defaultPageForRoles(tokenStore.user.roles));
}

// Klik baris tabel akun demo untuk mengisi form.
document.querySelectorAll('.table--compact tbody tr').forEach((row) => {
  row.style.cursor = 'pointer';
  row.addEventListener('click', () => {
    const cells = row.querySelectorAll('td');
    $('#email').value = cells[1].textContent.trim();
    $('#password').value = cells[2].textContent.trim();
    $('#email').focus();
  });
});

/**
 * Tampilkan pesan error, termasuk error per-field bila ada.
 */
function showError(message, errors = null) {
  let text = message;
  if (errors) {
    const messages = Object.values(errors);
    if (messages.length) text = `${message} ${messages.join(' ')}`;
  }
  errorBox.textContent = text;
  errorBox.hidden = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.hidden = true;

  const email = $('#email').value.trim();
  const password = $('#password').value;

  if (!email || !password) {
    showError('Email dan password wajib diisi.');
    return;
  }

  try {
    await withBusyButton(
      button,
      (async () => {
        const result = await api.post('/auth/login', { email, password }, { auth: false });

        tokenStore.save({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          user: result.user,
        });

        toast(`Selamat datang, ${result.user.name}!`, 'success');

        // nextUrl sudah di-encode dari ui.js; decode lagi di sini.
        const target = nextUrl ? decodeURIComponent(nextUrl) : null;
        window.location.replace(target || defaultPageForRoles(result.user.roles));
      })(),
      'Memproses...'
    );
  } catch (error) {
    showError(error.message, fieldErrors(error));
    $('#password').value = '';
    $('#password').focus();
  }
});