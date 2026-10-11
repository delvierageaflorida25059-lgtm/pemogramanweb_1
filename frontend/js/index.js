/**
 * Landing page / pemilih peran.
 *
 * Menampilkan modul yang boleh diakses sesuai role dan permission pengguna
 * saat ini. Ini murni untuk kenyamanan navigasi - menyembunyikan kartu,
 * tapi otorisasi sebenarnya ditegakkan di backend pada setiap request.
 */

import { tokenStore } from './api.js';
import { $, escapeHtml, toast } from './ui.js';

const user = tokenStore.user;

const ROLE_LABELS = {
  ADMIN: 'Administrator',
  OWNER: 'Owner',
  MANAGER: 'Manager',
  CASHIER: 'Kasir',
  KITCHEN: 'Dapur',
  INVENTORY: 'Inventory',
  PROCUREMENT: 'Procurement',
  CUSTOMER: 'Pelanggan',
};

// Daftar modul: field "permission" dicek di frontend untuk menyembunyikan
// kartu, tapi tetap bukan placeholder keamanan.
const MODULES = [
  {
    href: '/dashboard.html',
    icon: 'M',
    title: 'Dashboard',
    desc: 'Ringkasan penjualan dan keuangan',
    permission: 'report.view',
  },
  {
    href: '/cashier.html',
    icon: '$',
    title: 'Kasir / POS',
    desc: 'Transaksi, pembayaran, dan struk',
    permission: 'order.create',
  },
  {
    href: '/kitchen.html',
    icon: 'D',
    title: 'Kitchen Display',
    desc: 'Papan pesanan dapur',
    permission: 'kitchen.view',
  },
  {
    href: '/admin-menu.html',
    icon: 'K',
    title: 'Kelola Menu',
    desc: 'Kategori, produk, varian, dan addon',
    permission: 'product.manage',
  },
  {
    href: '/admin-inventory.html',
    icon: 'B',
    title: 'Inventory',
    desc: 'Stok bahan baku dan resep (BOM)',
    permission: 'inventory.view',
  },
  {
    href: '/admin-tables.html',
    icon: 'B',
    title: 'Meja & QR Code',
    desc: 'Atur meja dan terbitkan QR',
    permission: 'table.view',
  },
  {
    href: '/admin-orders.html',
    icon: 'O',
    title: 'Pesanan',
    desc: 'Daftar dan riwayat transaksi',
    permission: 'order.view',
  },
  {
    href: '/admin-payments.html',
    icon: 'B',
    title: 'Pembayaran',
    desc: 'Riwayat pembayaran dan refund',
    permission: 'payment.view',
  },
  {
    href: '/admin-users.html',
    icon: 'U',
    title: 'User & Role',
    desc: 'Kelola pengguna dan hak akses',
    permission: 'user.view',
  },
  {
    href: '/menu.html',
    icon: 'P',
    title: 'Menu Pelanggan',
    desc: 'Pratinjau menu QR Ordering',
    permission: null, // selalu tampil
  },
];

function canAccess(module) {
  if (!user) return module.permission === null;
  if (!module.permission) return true;
  if ((user.roles || []).includes('ADMIN')) return true;
  return (user.permissions || []).includes(module.permission);
}

function renderNav() {
  const nav = $('#appbar-nav');
  const links = MODULES.filter(canAccess).map(
    (module) => `<a class="appbar__link" href="${module.href}">${escapeHtml(module.title)}</a>`
  );
  nav.innerHTML = links.join('');
}

function renderRoles() {
  const container = $('#role-cards');

  if (!user) {
    $('#page-title').textContent = 'Selamat Datang';
    $('#page-subtitle').textContent =
      'Masuk untuk akses penuh, atau pilih "Menu Pelanggan" untuk melihat menu.';

    const cards = MODULES.filter(canAccess)
      .map(
        (module) => `
        <a class="role-card" href="${module.href}">
          <div class="role-card__icon">${escapeHtml(module.icon)}</div>
          <h2 class="role-card__title">${escapeHtml(module.title)}</h2>
          <p class="role-card__desc">${escapeHtml(module.desc)}</p>
        </a>
      `
      )
      .join('');

    container.innerHTML = `
      ${cards}
      <a class="role-card" href="/login.html">
        <div class="role-card__icon">M</div>
        <h2 class="role-card__title">Masuk</h2>
        <p class="role-card__desc">Login sebagai staff</p>
      </a>
    `;
    return;
  }

  $('#page-title').textContent = `Halo, ${user.name}`;
  $('#page-subtitle').textContent =
    'Peran: ' + (user.roles || []).map((role) => ROLE_LABELS[role] || role).join(', ');

  $('#user-label').textContent = user.name;
  $('#logout-button').hidden = false;

  container.innerHTML = MODULES.filter(canAccess)
    .map(
      (module) => `
      <a class="role-card" href="${module.href}">
        <div class="role-card__icon">${escapeHtml(module.icon)}</div>
        <h2 class="role-card__title">${escapeHtml(module.title)}</h2>
        <p class="role-card__desc">${escapeHtml(module.desc)}</p>
      </a>
    `
    )
    .join('');
}

$('#logout-button').addEventListener('click', async () => {
  try {
    await import('./api.js').then((module) =>
      module.api.post('/auth/logout', { refreshToken: tokenStore.refreshToken })
    );
  } catch {
    // Logout lokal tetap dilakukan walau server gagal dijangkau.
  }
  tokenStore.clear();
  toast('Anda telah keluar.', 'success');
  window.location.replace('/index.html');
});

renderNav();
renderRoles();