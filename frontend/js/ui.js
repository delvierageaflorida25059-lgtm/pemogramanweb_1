/**
 * Utilitas tampilan bersama: format angka, escape HTML, toast, modal, konfirmasi.
 *
 * Semua data dari server yang dimasukkan ke DOM harus lewat escapeHtml()
 * terlebih dahulu. Ini mencegah Stored XSS dari nama produk atau catatan
 * yang berisi tag HTML.
 */

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

/** Format angka menjadi Rupiah. Contoh: 32000 -> "Rp 32.000" */
export function rupiah(value) {
  const number = Math.round(Number(value) || 0);
  return `Rp ${number.toLocaleString('id-ID')}`;
}

/** Format angka biasa dengan desimal. */
export function number(value, decimals = 0) {
  return (Number(value) || 0).toLocaleString('id-ID', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Ubah string DATETIME dari MySQL ("2026-10-08 14:30:00") menjadi
 * "8 Okt 2026, 14:30".
 */
export function dateTime(value) {
  if (!value) return '-';
  const date = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Ubah DATETIME menjadi "14:30". */
export function timeOnly(value) {
  if (!value) return '-';
  const date = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(date);
}

/** Selisih waktu dalam bahasa manusia. Contoh: "3 menit lalu". */
export function timeAgo(value) {
  if (!value) return '-';
  const date = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return value;

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'Baru saja';

  const units = [
    ['menit', 60],
    ['jam', 3600],
    ['hari', 86400],
  ];

  let label = `${Math.floor(seconds / 60)} menit`;
  for (const [name, divisor] of units) {
    if (seconds >= divisor) label = `${Math.floor(seconds / divisor)} ${name}`;
  }
  return `${label} lalu`;
}

// ---------------------------------------------------------------------------
// Keamanan DOM
// ---------------------------------------------------------------------------

const HTML_ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escape karakter HTML. WAJIB dipakai untuk setiap nilai yang berasal dari
 * server atau input pengguna sebelum disisipkan lewat innerHTML.
 *
 * @param {any} value
 * @returns {string}
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (char) => HTML_ENTITIES[char]);
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

/**
 * Tampilkan notifikasi singkat di pojok layar.
 * @param {string} message
 * @param {'success'|'error'|'info'|'warning'} [type='info']
 * @param {number} [duration=3200]
 */
export function toast(message, type = 'info', duration = 3200) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const element = document.createElement('div');
  element.className = `toast toast--${type}`;
  element.setAttribute('role', type === 'error' ? 'alert' : 'status');
  element.textContent = message;
  container.appendChild(element);

  requestAnimationFrame(() => element.classList.add('toast--show'));

  setTimeout(() => {
    element.classList.remove('toast--show');
    setTimeout(() => element.remove(), 250);
  }, duration);
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

/**
 * Buka modal dan kembalikan object berisi tombol close + close() terprogram.
 *
 * @param {{title?:string, content:string, size?:'sm'|'md'|'lg', footer?:string}} options
 * @returns {{close:() => void, element:HTMLElement}}
 */
export function modal({ title = '', content = '', size = 'md', footer = '' }) {
  const backdrop = document.createElement('div');
  backdrop.className = `modal-backdrop modal-backdrop--${size}`;
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      ${title ? `<header class="modal__header"><h2 class="modal__title">${escapeHtml(title)}</h2></header>` : ''}
      <div class="modal__body"></div>
      ${footer ? `<footer class="modal__footer">${footer}</footer>` : ''}
    </div>
  `;

  // Isi body dengan HTML mentah dari pemanggil (bukan input user langsung).
  const body = backdrop.querySelector('.modal__body');
  body.innerHTML = content;

  const close = () => {
    backdrop.classList.remove('modal-backdrop--show');
    setTimeout(() => backdrop.remove(), 200);
    document.removeEventListener('keydown', onKeydown);
  };

  function onKeydown(event) {
    if (event.key === 'Escape') close();
  }

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  backdrop.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', close);
  });
  document.addEventListener('keydown', onKeydown);

  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('modal-backdrop--show'));

  return { close, element: backdrop };
}

/**
 * Dialog konfirmasi yang mengembalikan Promise<boolean>.
 *
 * @param {string} title
 * @param {string} message
 * @param {{confirmLabel?:string, cancelLabel?:string, danger?:boolean}} [options]
 * @returns {Promise<boolean>}
 */
export function confirmDialog(title, message, options = {}) {
  const {
    confirmLabel = 'Ya, lanjutkan',
    cancelLabel = 'Batal',
    danger = false,
  } = options;

  return new Promise((resolve) => {
    const dialog = modal({
      title,
      size: 'sm',
      content: `<p class="modal__text">${escapeHtml(message)}</p>`,
      footer: `
        <button type="button" class="btn btn--ghost" data-close>${escapeHtml(cancelLabel)}</button>
        <button type="button" class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-confirm>
          ${escapeHtml(confirmLabel)}
        </button>
      `,
    });

    dialog.element.querySelector('[data-confirm]').addEventListener('click', () => {
      dialog.close();
      resolve(true);
    });

    dialog.element.addEventListener('click', (event) => {
      if (event.target === dialog.element || event.target.closest('[data-close]')) {
        resolve(false);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

/** Tunggu elemen muncul sebelum operatesi padanya. */
export function $(selector, scope = document) {
  return scope.querySelector(selector);
}

/** @returns {HTMLElement[]} */
export function $$(selector, scope = document) {
  return Array.from(scope.querySelectorAll(selector));
}

/**
 * Pasang event listener ke banyak elemen sekaligus.
 * @param {string} selector
 * @param {string} event
 * @param {Function} handler
 */
export function onAll(selector, event, handler, scope = document) {
  $$(selector, scope).forEach((element) => element.addEventListener(event, handler));
}

/** Tampilkan state loading di dalam sebuah container. */
export function showLoading(container, message = 'Memuat data...') {
  container.innerHTML = `
    <div class="state state--loading">
      <div class="spinner" aria-hidden="true"></div>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

/** Tampilkan pesan error dengan tombol coba lagi. */
export function showError(container, message, onRetry = null) {
  const retryButton = onRetry
    ? '<button type="button" class="btn btn--outline" data-retry>Coba lagi</button>'
    : '';

  container.innerHTML = `
    <div class="state state--error">
      <p class="state__message">${escapeHtml(message)}</p>
      ${retryButton}
    </div>
  `;

  const button = container.querySelector('[data-retry]');
  if (button) button.addEventListener('click', onRetry);
}

/** Tampilkan pesan kosong. */
export function showEmpty(container, message, icon = 'kosong') {
  container.innerHTML = `
    <div class="state state--empty">
      <p class="state__message">${escapeHtml(message)}</p>
    </div>
  `;
}

/**
 * Cegah submit form ganda dengan mengunci tombol selama request berjalan.
 * @param {HTMLButtonElement} button
 * @param {Promise} promise
 */
export async function withBusyButton(button, promise, busyText = 'Memproses...') {
  if (!button) return promise;

  const originalLabel = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span class="spinner spinner--small"></span> ${escapeHtml(busyText)}`;

  try {
    return await promise;
  } finally {
    button.disabled = false;
    button.innerHTML = originalLabel;
  }
}

// ---------------------------------------------------------------------------
// Navigasi
// ---------------------------------------------------------------------------

/**
 * Redirect ke halaman login bila belum masuk. mengembalikan true kalau
 * pengguna sudah terautentikasi.
 *
 * @param {{requiredRoles?:string[], requiredPermissions?:string[]}} [options]
 * @returns {boolean}
 */
export function requireLogin(options = {}) {
  const { requiredRoles = [], requiredPermissions = [] } = options;

  if (!localStorage.getItem('sr_access_token')) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`/login.html?next=${next}`);
    return false;
  }

  let user = null;
  try {
    user = JSON.parse(localStorage.getItem('sr_user') || 'null');
  } catch {
    user = null;
  }

  if (requiredRoles.length > 0) {
    const owned = user?.roles || [];
    if (!requiredRoles.some((role) => owned.includes(role))) {
      toast('Anda tidak memiliki akses ke halaman ini.', 'error');
      window.location.replace('/index.html');
      return false;
    }
  }

  if (requiredPermissions.length > 0) {
    const owned = user?.permissions || [];
    const isAdmin = (user?.roles || []).includes('ADMIN');
    if (!isAdmin && !requiredPermissions.some((permission) => owned.includes(permission))) {
      toast('Izin Anda tidak mencukupi untuk halaman ini.', 'error');
      window.location.replace('/index.html');
      return false;
    }
  }

  return true;
}

/** Halaman tujuan setelah login, berdasarkan role pengguna. */
export function defaultPageForRoles(roles = []) {
  if (roles.includes('ADMIN') || roles.includes('OWNER') || roles.includes('MANAGER')) {
    return '/dashboard.html';
  }
  if (roles.includes('KITCHEN')) return '/kitchen.html';
  if (roles.includes('CASHIER')) return '/cashier.html';
  if (roles.includes('CUSTOMER')) return '/index.html';
  return '/index.html';
}